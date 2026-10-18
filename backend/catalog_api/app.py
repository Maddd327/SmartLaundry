"""Catalog service owns catalog.services. No ordering tables are queried here."""
import os
from uuid import uuid4

from flask import Flask, jsonify, request

from backend.common import ApiError, database, fields, install_errors, json_body, positive_int, text_value

SELECT_SERVICE = '''SELECT id,name,description,category,price_kg,price_item,
                            supported_units,duration_minutes,active,created_at,updated_at
                     FROM catalog.services'''
SERVICE_FIELDS = {'name','description','category','price_kg','price_item','supported_units','duration_minutes','active'}


def validate_service(data):
    data = dict(data)
    data['name'] = text_value(data['name'], 'Nama layanan', 120)
    data['description'] = text_value(data['description'], 'Deskripsi', 500, allow_empty=True)
    data['category'] = text_value(data['category'], 'Kategori', 80)
    data['price_kg'] = positive_int(data['price_kg'], 'Harga per kg')
    data['price_item'] = positive_int(data['price_item'], 'Harga per item')
    data['duration_minutes'] = positive_int(data['duration_minutes'], 'Durasi menit')
    if data['duration_minutes'] > 525600:
        raise ApiError(422, 'Durasi maksimal satu tahun.')
    units = data['supported_units']
    if not isinstance(units, list) or not units or len(units) > 2 or any(not isinstance(unit, str) for unit in units) or set(units) - {'kg','item'} or len(units) != len(set(units)):
        raise ApiError(422, 'supported_units harus berisi kg dan/atau item tanpa duplikat.')
    if not isinstance(data['active'], bool):
        raise ApiError(422, 'active harus boolean.')
    return data


def service_json(row):
    return {**row, 'created_at': row['created_at'].isoformat(), 'updated_at': row['updated_at'].isoformat()}


def create_app():
    app = Flask(__name__)
    app.config['DATABASE_URL'] = os.getenv('DATABASE_URL', '')
    install_errors(app)

    @app.get('/healthz')
    def healthz():
        with database() as conn:
            conn.execute('SELECT 1 FROM catalog.services LIMIT 1')
        return jsonify(service='catalog-api', status='ok')

    @app.get('/api/services')
    def list_services():
        include_inactive = request.args.get('include_inactive', 'false')
        if include_inactive not in ('true','false'):
            raise ApiError(422, 'include_inactive harus true atau false.')
        with database() as conn:
            query = SELECT_SERVICE + (' ORDER BY name' if include_inactive == 'true' else ' WHERE active = TRUE ORDER BY name')
            rows = conn.execute(query).fetchall()
        return jsonify(services=[service_json(row) for row in rows])

    @app.post('/api/services')
    def create_service():
        data = json_body()
        fields(data, SERVICE_FIELDS, SERVICE_FIELDS - {'active','description'})
        data = validate_service({'description':'', 'active':True, **data})
        service_id = 'svc-' + uuid4().hex
        with database() as conn:
            row = conn.execute('''INSERT INTO catalog.services
                (id,name,description,category,price_kg,price_item,supported_units,duration_minutes,active)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
                (service_id,data['name'],data['description'],data['category'],data['price_kg'],
                 data['price_item'],data['supported_units'],data['duration_minutes'],data['active'])).fetchone()
            service = conn.execute(SELECT_SERVICE + ' WHERE id=%s', (row['id'],)).fetchone()
        return jsonify(service=service_json(service)), 201

    @app.patch('/api/services/<service_id>')
    def update_service(service_id):
        data = json_body()
        fields(data, SERVICE_FIELDS)
        if not data:
            raise ApiError(400, 'Isi setidaknya satu kolom layanan.')
        with database() as conn:
            current = conn.execute(SELECT_SERVICE + ' WHERE id=%s FOR UPDATE', (service_id,)).fetchone()
            if current is None:
                raise ApiError(404, 'Layanan tidak ditemukan.')
            merged = validate_service({key: data.get(key, current[key]) for key in SERVICE_FIELDS})
            conn.execute('''UPDATE catalog.services SET name=%s,description=%s,category=%s,
                price_kg=%s,price_item=%s,supported_units=%s,duration_minutes=%s,active=%s,
                updated_at=now() WHERE id=%s''',
                (merged['name'],merged['description'],merged['category'],merged['price_kg'],
                 merged['price_item'],merged['supported_units'],merged['duration_minutes'],
                 merged['active'],service_id))
            service = conn.execute(SELECT_SERVICE + ' WHERE id=%s', (service_id,)).fetchone()
        return jsonify(service=service_json(service))

    return app


app = create_app()
if __name__ == '__main__':
    app.run(host=os.getenv('HOST','127.0.0.1'), port=int(os.getenv('PORT','5001')))
