import pytest

from backend.common import ApiError
from backend.order_api.domain import calculate_items, payment_status

SERVICES = [
    {'id':'regular','name':'Cuci Setrika Regular','price_kg':6000,'price_item':18000,
     'supported_units':['kg','item'],'duration_minutes':2880,'active':True},
    {'id':'iron','name':'Setrika Saja','price_kg':3000,'price_item':5000,
     'supported_units':['kg','item'],'duration_minutes':240,'active':True},
]


def test_total_uses_catalog_prices_and_decimal_kg():
    items, subtotal, duration = calculate_items([
        {'service_id':'regular','unit':'kg','quantity':'2.5'},
        {'service_id':'iron','unit':'item','quantity':2},
    ], SERVICES)
    assert [item['line_total'] for item in items] == [15000,10000]
    assert subtotal == 25000
    assert duration == 2880
    assert items[0]['unit_price'] == 6000


def test_item_rejects_fraction_and_inactive_service():
    with pytest.raises(ApiError, match='bilangan bulat'):
        calculate_items([{'service_id':'iron','unit':'item','quantity':'1.5'}], SERVICES)
    inactive = [{**SERVICES[0], 'active':False}]
    with pytest.raises(ApiError, match='tidak ditemukan'):
        calculate_items([{'service_id':'regular','unit':'kg','quantity':1}], inactive)


def test_payment_status_from_total_paid():
    assert payment_status(18000,0) == 'belum_bayar'
    assert payment_status(18000,5000) == 'dp'
    assert payment_status(18000,18000) == 'lunas'
    assert payment_status(0,0) == 'lunas'
