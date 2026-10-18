"""Create local Compose credentials without printing or committing them."""
import os
from pathlib import Path
from secrets import token_urlsafe


def main():
    target = Path(__file__).resolve().parent.parent / '.env'
    names = ('POSTGRES_PASSWORD', 'CATALOG_DB_PASSWORD', 'ORDER_DB_PASSWORD')
    if target.exists():
        existing = dict(
            line.split('=', 1) for line in target.read_text(encoding='utf-8').splitlines()
            if '=' in line and not line.startswith('#')
        )
        missing = [name for name in names if f'SMARTLAUNDRY_{name}' not in existing]
        if not missing:
            print('.env sudah ada; kredensial tidak diubah.')
            return
        os.chmod(target, 0o600)
        with target.open('a', encoding='utf-8') as stream:
            for name in missing:
                stream.write(f'SMARTLAUNDRY_{name}={existing.get(name) or token_urlsafe(36)}\n')
        print('.env lama disesuaikan tanpa mengganti kredensial yang ada; nilainya tidak ditampilkan.')
        return
    content = ''.join(f'SMARTLAUNDRY_{name}={token_urlsafe(36)}\n' for name in names)
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print('.env dibuat oleh proses lain; jalankan ulang untuk memeriksanya.')
        return
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        stream.write(content)
    print('.env dibuat dengan izin hanya untuk pemilik; nilainya tidak ditampilkan.')


if __name__ == '__main__':
    main()
