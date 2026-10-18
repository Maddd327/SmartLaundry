"""Order service owns ordering.* and reads catalog only through HTTP."""
import hashlib
import json
import os
from datetime import date, datetime, time, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
from flask import Flask, current_app, jsonify, request

from backend.common import (ApiError, database, date_value, datetime_value, fields,
                            install_errors, json_body, json_safe, positive_int,
                            text_value, uuid_value, whatsapp_value)
from backend.order_api.domain import calculate_items, payment_status, quantity_value

ORDER_STATUSES = {'baru','diproses','selesai','diambil','dibatalkan'}
PAYMENT_METHODS = {'tunai','transfer','qris'}
PUBLIC_STATUS_LABELS = {
    'menunggu_konfirmasi': 'Menunggu konfirmasi',
    'baru': 'Antre', 'diproses': 'Diproses', 'selesai': 'Siap diambil',
    'diambil': 'Selesai', 'dibatalkan': 'Dibatalkan',
}
JAKARTA = ZoneInfo('Asia/Jakarta')
ORDER_SELECT = '''SELECT o.*, COALESCE(o.request_name,c.name) AS customer_name,c.whatsapp AS customer_whatsapp,
                   COALESCE(p.paid_amount,0)::BIGINT AS paid_amount,
                   (SELECT string_agg(i.service_name, ', ' ORDER BY i.id) FROM ordering.order_items i WHERE i.order_id=o.id) AS item_summary,
                   (SELECT string_agg(trim(trailing '.' from trim(trailing '0' from i.quantity::text)) || ' ' || i.unit, ', ' ORDER BY i.id) FROM ordering.order_items i WHERE i.order_id=o.id) AS quantity_summary
                  FROM ordering.orders o JOIN ordering.customers c ON c.id=o.customer_id
                  LEFT JOIN (SELECT order_id,SUM(amount) AS paid_amount FROM ordering.payments
                             GROUP BY order_id) p ON p.order_id=o.id'''


def fetch_services():
    url = current_app.config['CATALOG_API_URL'].rstrip('/') + '/api/services'
    try:
        with urlopen(url, timeout=3) as response:
            data = json.load(response)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        current_app.logger.warning('Catalog API unavailable: %s', error)
        raise ApiError(503, 'Catalog API tidak tersedia; order belum dibuat.') from None
    if not isinstance(data, dict) or not isinstance(data.get('services'), list):
        raise ApiError(502, 'Respons Catalog API tidak valid; order belum dibuat.')
    return data['services']


def customer_json(row):
    return json_safe(row)


def order_json(row):
    data = json_safe(row)
    data.pop('request_hash', None)
    data['payment_status'] = payment_status(data['total'], data['paid_amount'])
    return data


def get_order(conn, order_id):
    row = conn.execute(ORDER_SELECT + ' WHERE o.id=%s', (order_id,)).fetchone()
    if row is None:
        raise ApiError(404, 'Order tidak ditemukan.')
    data = order_json(row)
    data['items'] = json_safe(conn.execute('''SELECT id,service_id,service_name,unit_price,unit,quantity,line_total
        FROM ordering.order_items WHERE order_id=%s ORDER BY id''', (order_id,)).fetchall())
    data['payments'] = json_safe(conn.execute('''SELECT id,amount,method,paid_at
        FROM ordering.payments WHERE order_id=%s ORDER BY paid_at,id''', (order_id,)).fetchall())
    return data


def normalize_order_request(data):
    fields(data, {'client_order_id','customer_id','items','discount','ordered_at','note'},
           {'client_order_id','customer_id','items'})
    client_order_id = text_value(data['client_order_id'], 'client_order_id', 120)
    customer_id = uuid_value(data['customer_id'], 'customer_id')
    discount = positive_int(data.get('discount',0), 'Diskon', allow_zero=True)
    note = text_value(data.get('note',''), 'Catatan order', 1000, allow_empty=True)
    raw_items = data['items']
    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 50:
        raise ApiError(422, 'Order harus memiliki 1 sampai 50 item.')
    items = []
    for raw in raw_items:
        if not isinstance(raw, dict) or set(raw) != {'service_id','unit','quantity'}:
            raise ApiError(422, 'Setiap item hanya boleh berisi service_id, unit, dan quantity.')
        unit = raw['unit']
        if unit not in ('kg','item'):
            raise ApiError(422, 'Satuan harus kg atau item.')
        service_id = text_value(raw['service_id'], 'service_id', 120)
        quantity = quantity_value(raw['quantity'], unit)
        items.append({'service_id':service_id,'unit':unit,'quantity':format(quantity.normalize(),'f')})
    ordered_at_raw = data.get('ordered_at')
    ordered_at = datetime_value(ordered_at_raw, 'ordered_at') if ordered_at_raw is not None else None
    if ordered_at is not None and ordered_at > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ApiError(422, 'Tanggal order tidak boleh di masa depan.')
    canonical = {'client_order_id':client_order_id,'customer_id':str(customer_id),
                 'items':items,'discount':discount,'note':note,
                 'ordered_at':ordered_at.astimezone(timezone.utc).isoformat() if ordered_at else None}
    request_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(',',':')).encode()).hexdigest()
    return canonical, request_hash, ordered_at or datetime.now(timezone.utc)


def existing_for_key(conn, key, request_hash):
    existing = conn.execute('SELECT id,request_hash FROM ordering.orders WHERE client_order_id=%s', (key,)).fetchone()
    if existing is None:
        return None
    if existing['request_hash'].strip() != request_hash:
        raise ApiError(409, 'client_order_id sudah dipakai untuk isi order yang berbeda.')
    return existing['id']


def normalize_public_request(data):
    fields(data, {'client_request_id','name','whatsapp','service_id','unit','quantity','requested_date','note'},
           {'client_request_id','name','whatsapp','service_id','unit','quantity','requested_date'})
    request_id = uuid_value(data['client_request_id'], 'client_request_id')
    name = text_value(data['name'], 'Nama pelanggan', 120)
    phone = whatsapp_value(data['whatsapp'])
    service_id = text_value(data['service_id'], 'service_id', 120)
    unit = data['unit']
    if unit not in ('kg','item'):
        raise ApiError(422, 'Satuan harus kg atau item.')
    quantity = quantity_value(data['quantity'], unit)
    requested_date = date_value(data['requested_date'], 'requested_date')
    today = datetime.now(JAKARTA).date()
    if requested_date < today or requested_date > today + timedelta(days=60):
        raise ApiError(422, 'Tanggal yang diinginkan harus hari ini sampai 60 hari ke depan.')
    note = text_value(data.get('note',''), 'Catatan order', 1000, allow_empty=True)
    canonical = {'client_request_id': str(request_id), 'name': name, 'whatsapp': phone,
                 'service_id': service_id, 'unit': unit, 'quantity': format(quantity.normalize(),'f'),
                 'requested_date': requested_date.isoformat(), 'note': note}
    request_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(',',':')).encode()).hexdigest()
    return canonical, request_hash


def public_request_json(order):
    return {'tracking_code': order['id'], 'status': order['status'],
            'status_label': PUBLIC_STATUS_LABELS[order['status']],
            'estimated_total': order['total'],
            'expected_completed_at': order['expected_completed_at']}


def create_app():
    app = Flask(__name__)
    app.config['DATABASE_URL'] = os.getenv('DATABASE_URL','')
    app.config['CATALOG_API_URL'] = os.getenv('CATALOG_API_URL','http://127.0.0.1:5001')
    app.config['INSTANCE_ID'] = os.getenv('INSTANCE_ID') or f'order-api-{os.getpid()}'
    install_errors(app)

    @app.after_request
    def identity_header(response):
        response.headers['X-Instance-ID'] = app.config['INSTANCE_ID']
        return response

    @app.get('/healthz')
    def healthz():
        with database() as conn:
            conn.execute('SELECT 1 FROM ordering.orders LIMIT 1')
        return jsonify(service='order-api', status='ok', instance_id=app.config['INSTANCE_ID'])

    @app.get('/api/customers')
    def list_customers():
        with database() as conn:
            rows = conn.execute('''SELECT id,name,whatsapp,additional_contact,created_at,updated_at
                FROM ordering.customers ORDER BY created_at DESC LIMIT 100''').fetchall()
        return jsonify(customers=json_safe(rows))

    @app.post('/api/customers')
    def create_customer():
        data = json_body()
        fields(data, {'name','whatsapp','additional_contact'}, {'name','whatsapp'})
        name = text_value(data['name'], 'Nama pelanggan', 120)
        phone = whatsapp_value(data['whatsapp'])
        contact = data.get('additional_contact')
        contact = text_value(contact, 'Kontak tambahan', 200, allow_empty=True) if contact is not None else None
        try:
            with database() as conn:
                row = conn.execute('''INSERT INTO ordering.customers(id,name,whatsapp,additional_contact)
                    VALUES (%s,%s,%s,%s) RETURNING *''', (uuid4(),name,phone,contact)).fetchone()
        except psycopg.errors.UniqueViolation:
            raise ApiError(409, 'Nomor WhatsApp pelanggan sudah terdaftar.') from None
        return jsonify(customer=customer_json(row)), 201

    @app.patch('/api/customers/<customer_id>')
    def update_customer(customer_id):
        customer_id = uuid_value(customer_id, 'ID pelanggan')
        data = json_body()
        fields(data, {'name','whatsapp','additional_contact'})
        if not data:
            raise ApiError(400, 'Isi setidaknya satu kolom pelanggan.')
        try:
            with database() as conn:
                current = conn.execute('SELECT * FROM ordering.customers WHERE id=%s FOR UPDATE', (customer_id,)).fetchone()
                if current is None:
                    raise ApiError(404, 'Pelanggan tidak ditemukan.')
                name = text_value(data.get('name',current['name']), 'Nama pelanggan', 120)
                phone = whatsapp_value(data.get('whatsapp',current['whatsapp']))
                contact = data.get('additional_contact',current['additional_contact'])
                contact = text_value(contact, 'Kontak tambahan', 200, allow_empty=True) if contact is not None else None
                row = conn.execute('''UPDATE ordering.customers SET name=%s,whatsapp=%s,
                    additional_contact=%s,updated_at=now() WHERE id=%s RETURNING *''',
                    (name,phone,contact,customer_id)).fetchone()
        except psycopg.errors.UniqueViolation:
            raise ApiError(409, 'Nomor WhatsApp pelanggan sudah terdaftar.') from None
        return jsonify(customer=customer_json(row))

    @app.get('/api/orders')
    def list_orders():
        with database() as conn:
            rows = conn.execute(ORDER_SELECT + ' ORDER BY o.ordered_at DESC LIMIT 100').fetchall()
        return jsonify(orders=[order_json(row) for row in rows])

    @app.get('/api/track')
    def public_tracking():
        if set(request.args) != {'code'} or len(request.args.getlist('code')) != 1:
            raise ApiError(400, 'Isi satu kode lacak order.')
        order_id = uuid_value(request.args['code'], 'Kode lacak')
        with database() as conn:
            row = conn.execute('''SELECT id,status,expected_completed_at,updated_at
                FROM ordering.orders WHERE id=%s''', (order_id,)).fetchone()
        if row is None:
            raise ApiError(404, 'Kode lacak tidak ditemukan. Periksa kode pada struk atau tanyakan outlet.')
        result = jsonify(tracking={
            'code': str(row['id']),
            'status': row['status'],
            'status_label': PUBLIC_STATUS_LABELS[row['status']],
            'expected_completed_at': row['expected_completed_at'].isoformat(),
            'updated_at': row['updated_at'].isoformat(),
        })
        result.headers['Cache-Control'] = 'no-store'
        return result

    @app.post('/api/requests')
    def create_public_request():
        canonical, request_hash = normalize_public_request(json_body())
        key = 'public:' + canonical['client_request_id']
        # Kunci transaksi membuat retry serentak berhenti sebelum menyentuh pelanggan.
        with database() as conn:
            conn.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', (key,))
            existing_id = existing_for_key(conn, key, request_hash)
            if existing_id:
                result = jsonify(request=public_request_json(get_order(conn, existing_id)), idempotent_replay=True)
                result.headers['Cache-Control'] = 'no-store'
                return result, 200
            catalog_services = fetch_services()
            items, subtotal, duration_minutes = calculate_items([{
                'service_id': canonical['service_id'], 'unit': canonical['unit'],
                'quantity': canonical['quantity'],
            }], catalog_services)
            customer = conn.execute('''INSERT INTO ordering.customers(id,name,whatsapp)
                VALUES (%s,%s,%s) ON CONFLICT (whatsapp) DO UPDATE
                SET whatsapp=EXCLUDED.whatsapp RETURNING id''',
                (uuid4(), canonical['name'], canonical['whatsapp'])).fetchone()
            ordered_at = datetime.now(timezone.utc)
            requested_at = datetime.combine(date.fromisoformat(canonical['requested_date']), time(9), JAKARTA)
            expected_start = max(ordered_at, requested_at)
            order_id = uuid4()
            conn.execute('''INSERT INTO ordering.orders
                (id,client_order_id,request_hash,customer_id,ordered_at,status,source,requested_date,request_name,
                 subtotal,discount,total,expected_completed_at,note)
                VALUES (%s,%s,%s,%s,%s,'menunggu_konfirmasi','website',%s,%s,%s,0,%s,%s,%s)''',
                (order_id,key,request_hash,customer['id'],ordered_at,canonical['requested_date'],canonical['name'],
                 subtotal,subtotal,expected_start+timedelta(minutes=duration_minutes),canonical['note']))
            for item in items:
                conn.execute('''INSERT INTO ordering.order_items
                    (id,order_id,service_id,service_name,unit_price,unit,quantity,line_total)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                    (uuid4(),order_id,item['service_id'],item['service_name'],item['unit_price'],
                     item['unit'],item['quantity'],item['line_total']))
            result = jsonify(request=public_request_json(get_order(conn, order_id)), idempotent_replay=False)
        result.headers['Cache-Control'] = 'no-store'
        return result, 201

    @app.post('/api/orders')
    def create_order():
        canonical, request_hash, ordered_at = normalize_order_request(json_body())
        with database() as conn:
            existing_id = existing_for_key(conn, canonical['client_order_id'], request_hash)
            if existing_id:
                return jsonify(order=get_order(conn, existing_id), idempotent_replay=True), 200
        catalog_services = fetch_services()
        items, subtotal, duration_minutes = calculate_items(canonical['items'], catalog_services)
        discount = canonical['discount']
        if discount > subtotal:
            raise ApiError(422, 'Diskon tidak boleh melebihi subtotal.')
        order_id = uuid4()
        customer_id = uuid_value(canonical['customer_id'], 'customer_id')
        with database() as conn:
            if conn.execute('SELECT id FROM ordering.customers WHERE id=%s', (customer_id,)).fetchone() is None:
                raise ApiError(422, 'Pelanggan tidak ditemukan.')
            inserted = conn.execute('''INSERT INTO ordering.orders
                (id,client_order_id,request_hash,customer_id,ordered_at,status,subtotal,discount,total,expected_completed_at,note)
                VALUES (%s,%s,%s,%s,%s,'baru',%s,%s,%s,%s,%s)
                ON CONFLICT (client_order_id) DO NOTHING RETURNING id''',
                (order_id,canonical['client_order_id'],request_hash,customer_id,ordered_at,
                 subtotal,discount,subtotal-discount,ordered_at+timedelta(minutes=duration_minutes),canonical['note'])).fetchone()
            if inserted is None:
                existing_id = existing_for_key(conn, canonical['client_order_id'], request_hash)
                return jsonify(order=get_order(conn, existing_id), idempotent_replay=True), 200
            for item in items:
                conn.execute('''INSERT INTO ordering.order_items
                    (id,order_id,service_id,service_name,unit_price,unit,quantity,line_total)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                    (uuid4(),order_id,item['service_id'],item['service_name'],item['unit_price'],
                     item['unit'],item['quantity'],item['line_total']))
            result = get_order(conn, order_id)
        return jsonify(order=result, idempotent_replay=False), 201

    @app.get('/api/orders/<order_id>')
    def order_detail(order_id):
        order_id = uuid_value(order_id, 'ID order')
        with database() as conn:
            result = get_order(conn, order_id)
        return jsonify(order=result)

    @app.patch('/api/orders/<order_id>/status')
    def update_status(order_id):
        order_id = uuid_value(order_id, 'ID order')
        data = json_body()
        fields(data, {'status'}, {'status'})
        status = data['status']
        if status not in ORDER_STATUSES:
            raise ApiError(422, 'Status harus baru, diproses, selesai, diambil, atau dibatalkan.')
        with database() as conn:
            current = conn.execute('SELECT status FROM ordering.orders WHERE id=%s FOR UPDATE', (order_id,)).fetchone()
            if current is None:
                raise ApiError(404, 'Order tidak ditemukan.')
            if current['status'] == 'menunggu_konfirmasi' and status not in ('baru','dibatalkan'):
                raise ApiError(422, 'Konfirmasi permintaan dahulu dengan status Antre, atau batalkan.')
            conn.execute('UPDATE ordering.orders SET status=%s,updated_at=now() WHERE id=%s', (status,order_id))
            result = get_order(conn, order_id)
        return jsonify(order=result)

    @app.post('/api/orders/<order_id>/payments')
    def add_payment(order_id):
        order_id = uuid_value(order_id, 'ID order')
        data = json_body()
        fields(data, {'amount','method','paid_at'}, {'amount','method'})
        amount = positive_int(data['amount'], 'Nominal pembayaran')
        method = data['method']
        if method not in PAYMENT_METHODS:
            raise ApiError(422, 'Metode pembayaran harus tunai, transfer, atau qris.')
        paid_at = datetime_value(data['paid_at'], 'paid_at') if 'paid_at' in data else datetime.now(timezone.utc)
        if paid_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ApiError(422, 'Tanggal pembayaran tidak boleh di masa depan.')
        with database() as conn:
            order = conn.execute('SELECT id,total,status FROM ordering.orders WHERE id=%s FOR UPDATE', (order_id,)).fetchone()
            if order is None:
                raise ApiError(404, 'Order tidak ditemukan.')
            if order['status'] in ('menunggu_konfirmasi','dibatalkan'):
                raise ApiError(422, 'Konfirmasi permintaan dahulu sebelum mencatat pembayaran.')
            paid = conn.execute('SELECT COALESCE(SUM(amount),0)::BIGINT AS amount FROM ordering.payments WHERE order_id=%s',
                                (order_id,)).fetchone()['amount']
            if paid + amount > order['total']:
                raise ApiError(422, 'Total pembayaran melebihi total order.')
            conn.execute('INSERT INTO ordering.payments(id,order_id,amount,method,paid_at) VALUES (%s,%s,%s,%s,%s)',
                         (uuid4(),order_id,amount,method,paid_at))
            result = get_order(conn, order_id)
        return jsonify(order=result), 201

    @app.get('/api/orders/<order_id>/receipt')
    def receipt(order_id):
        order_id = uuid_value(order_id, 'ID order')
        with database() as conn:
            result = get_order(conn, order_id)
        return jsonify(receipt={'business_name':'Laundry Mr Andy', 'order':result})

    @app.get('/api/expenses')
    def list_expenses():
        with database() as conn:
            rows = conn.execute('SELECT * FROM ordering.expenses ORDER BY expense_date DESC,created_at DESC LIMIT 100').fetchall()
        return jsonify(expenses=json_safe(rows))

    @app.post('/api/expenses')
    def create_expense():
        data = json_body()
        fields(data, {'category','description','amount','expense_date'},
               {'category','description','amount','expense_date'})
        category = text_value(data['category'], 'Kategori pengeluaran', 80)
        description = text_value(data['description'], 'Deskripsi pengeluaran', 500)
        amount = positive_int(data['amount'], 'Nominal pengeluaran')
        expense_date = date_value(data['expense_date'], 'expense_date')
        if expense_date > datetime.now(JAKARTA).date():
            raise ApiError(422, 'Tanggal pengeluaran tidak boleh di masa depan.')
        with database() as conn:
            row = conn.execute('''INSERT INTO ordering.expenses(id,category,description,amount,expense_date)
                VALUES (%s,%s,%s,%s,%s) RETURNING *''',
                (uuid4(),category,description,amount,expense_date)).fetchone()
        return jsonify(expense=json_safe(row)), 201

    @app.get('/api/reports/summary')
    def report_summary():
        start = date_value(request.args.get('from'), 'from')
        end = date_value(request.args.get('to'), 'to')
        if start > end:
            raise ApiError(422, 'Tanggal from harus sebelum atau sama dengan to.')
        if (end-start).days > 366:
            raise ApiError(422, 'Rentang laporan maksimal 366 hari.')
        start_at = datetime.combine(start,time.min,JAKARTA)
        end_at = datetime.combine(end+timedelta(days=1),time.min,JAKARTA)
        with database() as conn:
            orders = conn.execute('''SELECT COUNT(*)::INT AS count,COALESCE(SUM(total),0)::BIGINT AS total
                FROM ordering.orders WHERE ordered_at >= %s AND ordered_at < %s''', (start_at,end_at)).fetchone()
            payments = conn.execute('''SELECT COALESCE(SUM(amount),0)::BIGINT AS total
                FROM ordering.payments WHERE paid_at >= %s AND paid_at < %s''', (start_at,end_at)).fetchone()
            expenses = conn.execute('''SELECT COUNT(*)::INT AS count,COALESCE(SUM(amount),0)::BIGINT AS total
                FROM ordering.expenses WHERE expense_date BETWEEN %s AND %s''', (start,end)).fetchone()
        return jsonify(from_date=start.isoformat(),to_date=end.isoformat(),orders=orders,
                       payments=payments,expenses=expenses,net_cashflow=payments['total']-expenses['total'])

    return app


app = create_app()
if __name__ == '__main__':
    app.run(host=os.getenv('HOST','127.0.0.1'), port=int(os.getenv('PORT','5002')))
