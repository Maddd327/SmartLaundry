"""Run only against a dedicated *_test PostgreSQL database."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Thread
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
import pytest
from werkzeug.serving import make_server

from backend.common import ApiError
from backend.catalog_api.app import create_app as create_catalog_app
from backend.order_api.app import create_app as create_order_app

ADMIN_URL = os.getenv('TEST_ADMIN_DATABASE_URL')
CATALOG_URL = os.getenv('TEST_CATALOG_DATABASE_URL')
ORDER_URL = os.getenv('TEST_ORDER_DATABASE_URL')
pytestmark = pytest.mark.skipif(not all((ADMIN_URL,CATALOG_URL,ORDER_URL)),
                                reason='Set TEST_ADMIN_DATABASE_URL, TEST_CATALOG_DATABASE_URL, TEST_ORDER_DATABASE_URL')


@pytest.fixture
def api():
    with psycopg.connect(ADMIN_URL) as conn:
        database_name = conn.execute('SELECT current_database()').fetchone()[0]
        if not database_name.endswith('_test'):
            raise RuntimeError('Tes integrasi hanya boleh memakai database bernama *_test.')
        conn.execute('TRUNCATE ordering.payments,ordering.order_items,ordering.orders,ordering.customers,ordering.expenses CASCADE')
        conn.execute("DELETE FROM catalog.services WHERE id LIKE 'svc-%'")
        conn.execute("UPDATE catalog.services SET price_kg=6000,price_item=18000,active=TRUE WHERE id='regular'")
        conn.execute("UPDATE catalog.services SET price_kg=8000,price_item=25000,active=TRUE WHERE id='express'")
        conn.execute("UPDATE catalog.services SET price_kg=3000,price_item=5000,active=TRUE WHERE id='iron'")
    catalog = create_catalog_app()
    catalog.config['DATABASE_URL'] = CATALOG_URL
    server = make_server('127.0.0.1', 0, catalog, threaded=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    order = create_order_app()
    order.config['DATABASE_URL'] = ORDER_URL
    order.config['CATALOG_API_URL'] = f'http://127.0.0.1:{server.server_port}'
    order.config['INSTANCE_ID'] = 'integration-test-1'
    try:
        yield catalog.test_client(), order.test_client(), order
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
        with psycopg.connect(ADMIN_URL) as conn:
            conn.execute('TRUNCATE ordering.payments,ordering.order_items,ordering.orders,ordering.customers,ordering.expenses CASCADE')
            conn.execute("DELETE FROM catalog.services WHERE id LIKE 'svc-%'")


def new_customer(client):
    response = client.post('/api/customers', json={'name':'Budi','whatsapp':'081234567890'})
    assert response.status_code == 201, response.json
    assert response.json['customer']['whatsapp'] == '6281234567890'
    return response.json['customer']['id']


def order_body(customer_id, key='web-confirmed-1'):
    return {'client_order_id':key,'customer_id':customer_id,
            'items':[{'service_id':'regular','unit':'kg','quantity':'2.5'},
                     {'service_id':'iron','unit':'item','quantity':2}],
            'discount':1000}


def test_service_ownership_snapshot_and_server_total(api):
    catalog, client, _ = api
    customer_id = new_customer(client)
    body = order_body(customer_id)
    body['note'] = 'Pisahkan warna'
    tampered = {**body, 'total':1}
    assert client.post('/api/orders',json=tampered).status_code == 400
    response = client.post('/api/orders',json=body)
    assert response.status_code == 201, response.json
    order = response.json['order']
    assert order['note'] == 'Pisahkan warna'
    summary = next(item for item in client.get('/api/orders').json['orders'] if item['id'] == order['id'])
    assert '2.5 kg' in summary['quantity_summary'] and '2 item' in summary['quantity_summary']
    assert (order['subtotal'],order['discount'],order['total']) == (25000,1000,24000)
    assert sorted((item['unit_price'],item['line_total']) for item in order['items']) == [(5000,10000),(6000,15000)]
    changed = catalog.patch('/api/services/regular', json={'price_kg':7000})
    assert changed.status_code == 200, changed.json
    old = client.get(f'/api/orders/{order["id"]}').json['order']
    assert old['total'] == 24000
    assert any(item['unit_price'] == 6000 for item in old['items'])
    new = client.post('/api/orders',json={**body,'client_order_id':'web-confirmed-2'})
    assert new.status_code == 201, new.json
    assert new.json['order']['total'] == 26500


def test_dp_lunas_receipt_report_and_invalid_payment(api):
    _, client, _ = api
    customer_id = new_customer(client)
    body = {'client_order_id':'payment-1','customer_id':customer_id,
            'items':[{'service_id':'regular','unit':'kg','quantity':2}]}
    order = client.post('/api/orders',json=body).json['order']
    order_id = order['id']
    assert order['total'] == 12000
    assert order['payment_status'] == 'belum_bayar'
    first = client.post(f'/api/orders/{order_id}/payments',json={'amount':5000,'method':'qris'})
    assert first.status_code == 201 and first.json['order']['payment_status'] == 'dp'
    assert client.post(f'/api/orders/{order_id}/payments',json={'amount':-1,'method':'tunai'}).status_code == 422
    assert client.post(f'/api/orders/{order_id}/payments',json={'amount':0,'method':'tunai'}).status_code == 422
    assert client.post(f'/api/orders/{order_id}/payments',json={'amount':8000,'method':'tunai'}).status_code == 422
    assert len(client.get(f'/api/orders/{order_id}').json['order']['payments']) == 1
    second = client.post(f'/api/orders/{order_id}/payments',json={'amount':7000,'method':'transfer'})
    assert second.status_code == 201 and second.json['order']['payment_status'] == 'lunas'
    assert second.json['order']['paid_amount'] == 12000
    assert client.get(f'/api/orders/{order_id}/receipt').json['receipt']['order']['payment_status'] == 'lunas'
    assert client.get('/healthz').headers['X-Instance-ID'] == 'integration-test-1'
    today = datetime.now(ZoneInfo('Asia/Jakarta')).date().isoformat()
    expense = client.post('/api/expenses',json={'category':'Deterjen','description':'Bahan cuci','amount':2000,'expense_date':today})
    assert expense.status_code == 201, expense.json
    report = client.get(f'/api/reports/summary?from={today}&to={today}')
    assert report.status_code == 200, report.json
    assert report.json['payments']['total'] == 12000
    assert report.json['expenses']['total'] == 2000
    assert report.json['net_cashflow'] == 10000


def test_client_order_id_prevents_duplicate_even_concurrently(api):
    _, client, app = api
    customer_id = new_customer(client)
    body = order_body(customer_id, 'retry-'+uuid4().hex)
    first = client.post('/api/orders',json=body)
    replay = client.post('/api/orders',json=body)
    conflict = client.post('/api/orders',json={**body,'discount':0})
    assert (first.status_code,replay.status_code,conflict.status_code) == (201,200,409)
    assert first.json['order']['id'] == replay.json['order']['id']
    concurrent_body = order_body(customer_id, 'race-'+uuid4().hex)
    def send(_):
        with app.test_client() as concurrent_client:
            response = concurrent_client.post('/api/orders',json=concurrent_body)
            return response.status_code, response.json['order']['id']
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, range(2)))
    assert sorted(code for code,_ in results) == [200,201]
    assert results[0][1] == results[1][1]
    assert len(client.get('/api/orders').json['orders']) == 2


def test_concurrent_payments_never_exceed_order_total(api):
    _, client, app = api
    customer_id = new_customer(client)
    body = {'client_order_id':'payment-race-'+uuid4().hex,'customer_id':customer_id,
            'items':[{'service_id':'regular','unit':'kg','quantity':1}]}
    order_id = client.post('/api/orders',json=body).json['order']['id']

    def pay(_):
        with app.test_client() as concurrent_client:
            response = concurrent_client.post(f'/api/orders/{order_id}/payments',
                                              json={'amount':4000,'method':'tunai'})
            return response.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(pay, range(2)))
    assert sorted(results) == [201,422]
    saved = client.get(f'/api/orders/{order_id}').json['order']
    assert saved['paid_amount'] == 4000
    assert len(saved['payments']) == 1


def test_failed_payment_response_rolls_back_insert(api, monkeypatch):
    import backend.order_api.app as order_module

    _, client, _ = api
    customer_id = new_customer(client)
    body = {'client_order_id':'payment-rollback-'+uuid4().hex,'customer_id':customer_id,
            'items':[{'service_id':'regular','unit':'kg','quantity':1}]}
    order_id = client.post('/api/orders',json=body).json['order']['id']

    def fail_after_insert(*_args):
        raise ApiError(503, 'Gagal membaca hasil pembayaran.')

    with monkeypatch.context() as patch:
        patch.setattr(order_module, 'get_order', fail_after_insert)
        response = client.post(f'/api/orders/{order_id}/payments',
                               json={'amount':2000,'method':'transfer'})
    assert response.status_code == 503
    saved = client.get(f'/api/orders/{order_id}').json['order']
    assert saved['paid_amount'] == 0
    assert saved['payments'] == []


def test_failed_item_insert_rolls_back_order_and_items(api, monkeypatch):
    import backend.order_api.app as order_module

    _, client, _ = api
    customer_id = new_customer(client)
    original_fetch = order_module.fetch_services

    def broken_catalog():
        services = original_fetch()
        return [*services, {**services[0], 'id':'broken', 'name':''}]

    monkeypatch.setattr(order_module, 'fetch_services', broken_catalog)
    key = 'rollback-'+uuid4().hex
    response = client.post('/api/orders', json={
        'client_order_id':key, 'customer_id':customer_id,
        'items':[{'service_id':'regular','unit':'kg','quantity':1},
                 {'service_id':'broken','unit':'item','quantity':1}],
    })
    assert response.status_code == 503
    with psycopg.connect(ADMIN_URL) as conn:
        assert conn.execute('SELECT count(*) FROM ordering.orders WHERE client_order_id=%s', (key,)).fetchone()[0] == 0
        assert conn.execute('SELECT count(*) FROM ordering.order_items').fetchone()[0] == 0


def test_roles_cannot_read_other_schema(api):
    with psycopg.connect(ORDER_URL) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute('SELECT * FROM catalog.services')
    with psycopg.connect(CATALOG_URL) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute('SELECT * FROM ordering.orders')


def test_catalog_and_customer_management_and_order_status(api):
    catalog, client, _ = api
    created = catalog.post('/api/services', json={
        'name':'Uji Satuan', 'category':'satuan', 'description':'Layanan uji',
        'price_kg':9000, 'price_item':12000, 'supported_units':['item'],
        'duration_minutes':60, 'active':False,
    })
    assert created.status_code == 201, created.json
    service_id = created.json['service']['id']
    assert service_id not in [item['id'] for item in catalog.get('/api/services').json['services']]
    assert service_id in [item['id'] for item in catalog.get('/api/services?include_inactive=true').json['services']]
    activated = catalog.patch(f'/api/services/{service_id}',json={'active':True,'price_item':13000})
    assert activated.status_code == 200 and activated.json['service']['price_item'] == 13000
    customer_id = new_customer(client)
    updated = client.patch(f'/api/customers/{customer_id}',json={'name':'Budi Santoso'})
    assert updated.status_code == 200 and updated.json['customer']['name'] == 'Budi Santoso'
    order = client.post('/api/orders',json={'client_order_id':'management-1','customer_id':customer_id,
        'items':[{'service_id':service_id,'unit':'item','quantity':1}]}).json['order']
    changed = client.patch(f'/api/orders/{order["id"]}/status',json={'status':'diproses'})
    assert changed.status_code == 200 and changed.json['order']['status'] == 'diproses'
