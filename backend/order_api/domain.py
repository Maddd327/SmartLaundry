"""Pure order calculation and payment rules. Currency is integer rupiah."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from backend.common import ApiError, positive_int


def quantity_value(value, unit):
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise ApiError(422, 'Jumlah harus angka positif.')
    try:
        quantity = Decimal(str(value).replace(',', '.'))
    except InvalidOperation:
        raise ApiError(422, 'Jumlah harus angka positif.') from None
    if not quantity.is_finite() or quantity <= 0 or quantity > 100000 or quantity.as_tuple().exponent < -3:
        raise ApiError(422, 'Jumlah harus positif, maksimal 100000, dan maksimal tiga angka desimal.')
    if unit == 'item' and quantity != quantity.to_integral_value():
        raise ApiError(422, 'Jumlah item harus bilangan bulat positif.')
    return quantity


def calculate_items(raw_items, services):
    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 50:
        raise ApiError(422, 'Order harus memiliki 1 sampai 50 item.')
    catalog = {item['id']: item for item in services if item.get('active') is True}
    result = []
    subtotal = 0
    longest_minutes = 0
    for raw in raw_items:
        if not isinstance(raw, dict) or set(raw) != {'service_id','unit','quantity'}:
            raise ApiError(422, 'Setiap item hanya boleh berisi service_id, unit, dan quantity.')
        service = catalog.get(raw['service_id']) if isinstance(raw['service_id'], str) else None
        if service is None:
            raise ApiError(422, f'Layanan aktif tidak ditemukan: {raw["service_id"]}.')
        unit = raw['unit']
        if unit not in ('kg','item') or unit not in service['supported_units']:
            raise ApiError(422, 'Jenis satuan tidak didukung layanan.')
        quantity = quantity_value(raw['quantity'], unit)
        price = positive_int(service['price_kg' if unit == 'kg' else 'price_item'], 'Harga katalog')
        line_total = int((quantity * price).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        if line_total <= 0:
            raise ApiError(422, 'Total baris harus lebih dari nol.')
        result.append({'service_id':service['id'], 'service_name':service['name'],
                       'unit_price':price, 'unit':unit, 'quantity':quantity,
                       'line_total':line_total})
        subtotal += line_total
        longest_minutes = max(longest_minutes, service['duration_minutes'])
    return result, subtotal, longest_minutes


def payment_status(total, paid):
    if total == 0:
        return 'lunas'
    if paid <= 0:
        return 'belum_bayar'
    if paid < total:
        return 'dp'
    return 'lunas'
