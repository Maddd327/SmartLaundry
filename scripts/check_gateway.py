"""Check public/admin Nginx boundary without creating data."""
import argparse
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request(base, path, method='GET', headers=None):
    payload = b'{}' if method in ('POST', 'PATCH', 'PUT') else None
    req = Request(base.rstrip('/') + path, data=payload, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    if payload is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with urlopen(req, timeout=7) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()


def expect(base, path, status, method='GET', request_headers=None):
    actual, headers, body = request(base, path, method, request_headers)
    if actual != status:
        raise AssertionError(f'{method} {base}{path}: HTTP {actual}, diharapkan {status}')
    print(f'{method:4} {base}{path}: {actual}')
    return headers, body


def main():
    parser = argparse.ArgumentParser(description='Periksa batas akses publik/admin SmartLoundry.')
    parser.add_argument('--public', default='http://127.0.0.1:8080')
    parser.add_argument('--admin', default='http://127.0.0.1:8081')
    args = parser.parse_args()

    _, public_html = expect(args.public, '/', 200)
    if b'Laundry Mr Andy' not in public_html:
        raise AssertionError('Halaman publik tidak memuat identitas usaha.')
    _, public_body = expect(args.public, '/api/services', 200)
    public_services = json.loads(public_body)['services']
    if any(not service['active'] for service in public_services):
        raise AssertionError('Katalog publik membocorkan layanan nonaktif.')
    expect(args.public, '/api/services?include_inactive=true', 400)
    expect(args.public, '/api/services?x=1', 400)
    for method in ('POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'):
        expect(args.public, '/api/services', 405, method)
    expect(args.public, '/api/services', 200, 'HEAD')
    expect(args.public, '/api/track', 400)
    expect(args.public, '/api/track?code=invalid', 422)
    for method in ('POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'):
        expect(args.public, '/api/track', 405, method)
    for path in ('/api/services/', '/api/services.json', '/api/services/../orders',
                 '/api/%6f%72ders', '/api/orders', '/api/customers',
                 '/api/expenses', '/api/orders/example/payments', '/healthz',
                 '/api/track/', '/api/track.json', '/api/track/../orders'):
        expect(args.public, path, 404)
    for method in ('GET', 'POST', 'PATCH', 'OPTIONS'):
        expect(args.public, '/api/customers', 404, method)
    for method, path in (('POST','/api/orders'), ('POST','/api/expenses'),
                         ('POST','/api/orders/example/payments'),
                         ('PATCH','/api/orders/example/status'),
                         ('PATCH','/api/services/regular')):
        expect(args.public, path, 404, method)
    expect(args.public, '/api/orders', 404, 'GET', {'Host':'127.0.0.1:8081'})
    expect(args.public, '/operasional.html', 404)
    expect(args.public, '/operasional.html?view=orders', 404)
    expect(args.public, '/js/operasional.js', 404)
    expect(args.public, '/api/reports/summary?from=2026-01-01&to=2026-01-01', 404)

    _, admin_html = expect(args.admin, '/operasional.html', 200)
    if b'Panel Operasional' not in admin_html:
        raise AssertionError('Halaman POS tidak tersedia di port admin.')
    _, admin_body = expect(args.admin, '/api/services?include_inactive=true', 200)
    admin_services = json.loads(admin_body)['services']
    if not {service['id'] for service in public_services} <= {service['id'] for service in admin_services}:
        raise AssertionError('Katalog publik tidak sesuai dengan katalog admin.')
    headers, body = expect(args.admin, '/api/orders', 200)
    if headers.get('X-Instance-ID') not in {'order-api-a', 'order-api-b'}:
        raise AssertionError('Header X-Instance-ID Order API tidak ditemukan.')
    if not isinstance(json.loads(body).get('orders'), list):
        raise AssertionError('Respons daftar order tidak valid.')
    print(f'OK: batas akses dan proxy berfungsi; Order API: {headers["X-Instance-ID"]}.')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, URLError, ValueError, KeyError) as error:
        raise SystemExit(f'GAGAL: {error}') from None
