"""Create local Compose credentials without printing or committing them."""
import os
from pathlib import Path
from secrets import token_urlsafe


def main():
    target = Path(__file__).resolve().parent.parent / '.env'
    content = ''.join(
        f'{name}={token_urlsafe(36)}\n'
        for name in ('POSTGRES_PASSWORD', 'CATALOG_DB_PASSWORD', 'ORDER_DB_PASSWORD')
    )
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print('.env sudah ada; kredensial tidak diubah.')
        return
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        stream.write(content)
    print('.env dibuat dengan izin hanya untuk pemilik; nilainya tidak ditampilkan.')


if __name__ == '__main__':
    main()
