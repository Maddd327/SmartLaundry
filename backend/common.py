"""Small HTTP and database helpers shared by the two independent Flask processes."""
import re
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

import psycopg
from flask import current_app, jsonify, request
from psycopg.rows import dict_row
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


def database():
    return psycopg.connect(current_app.config['DATABASE_URL'], row_factory=dict_row, connect_timeout=5)


def json_body():
    if not request.is_json:
        raise ApiError(415, 'Content-Type harus application/json.')
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, 'Badan permintaan harus objek JSON.')
    return data


def fields(data, allowed, required=()):
    unknown = set(data) - set(allowed)
    missing = set(required) - set(data)
    if unknown:
        raise ApiError(400, f'Kolom tidak dikenal: {", ".join(sorted(unknown))}.')
    if missing:
        raise ApiError(400, f'Kolom wajib: {", ".join(sorted(missing))}.')


def text_value(value, label, max_length=200, allow_empty=False):
    if not isinstance(value, str):
        raise ApiError(422, f'{label} harus berupa teks.')
    value = value.strip()
    if (not value and not allow_empty) or len(value) > max_length:
        raise ApiError(422, f'{label} harus berisi 1 sampai {max_length} karakter.' if not allow_empty else f'{label} maksimal {max_length} karakter.')
    return value


def positive_int(value, label, allow_zero=False):
    if isinstance(value, bool) or not isinstance(value, int) or value < (0 if allow_zero else 1):
        raise ApiError(422, f'{label} harus bilangan bulat {"nol atau positif" if allow_zero else "positif"}.')
    if value > 9_000_000_000_000:
        raise ApiError(422, f'{label} terlalu besar.')
    return value


def date_value(value, label):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ApiError(422, f'{label} harus tanggal ISO YYYY-MM-DD.')
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, f'{label} harus tanggal ISO YYYY-MM-DD.') from None


def datetime_value(value, label):
    if not isinstance(value, str):
        raise ApiError(422, f'{label} harus waktu ISO 8601 dengan zona waktu.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ApiError(422, f'{label} harus waktu ISO 8601 dengan zona waktu.') from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ApiError(422, f'{label} harus menyertakan zona waktu.')
    return parsed


def uuid_value(value, label):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ApiError(422, f'{label} harus UUID yang valid.') from None


def whatsapp_value(value):
    if not isinstance(value, str):
        raise ApiError(422, 'Nomor WhatsApp harus berupa teks.')
    compact = re.sub(r'[\s().-]', '', value)
    if compact.startswith('+62'):
        compact = compact[1:]
    elif compact.startswith('08'):
        compact = '62' + compact[1:]
    if not re.fullmatch(r'628\d{8,12}', compact):
        raise ApiError(422, 'Nomor WhatsApp Indonesia tidak valid (contoh 081234567890).')
    return compact


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return format(value.normalize(), 'f')
    return value


def install_errors(app):
    @app.errorhandler(ApiError)
    def api_error(error):
        return jsonify(error=error.message), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.errorhandler(psycopg.Error)
    def database_error(error):
        app.logger.exception('Database error')
        return jsonify(error='Database sementara tidak tersedia atau permintaan gagal diproses.'), 503
