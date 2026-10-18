"""Credential migration must keep existing PostgreSQL data reachable."""
from scripts import setup_env


def values(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines())


def test_legacy_env_keeps_passwords_and_is_repeatable(tmp_path, monkeypatch):
    monkeypatch.setattr(setup_env, '__file__', str(tmp_path / 'scripts' / 'setup_env.py'))
    target = tmp_path / '.env'
    target.write_text('POSTGRES_PASSWORD=old-admin\nCATALOG_DB_PASSWORD=old-catalog\nORDER_DB_PASSWORD=old-order\n')
    setup_env.main()
    result = values(target)
    assert result['SMARTLAUNDRY_POSTGRES_PASSWORD'] == 'old-admin'
    assert result['SMARTLAUNDRY_CATALOG_DB_PASSWORD'] == 'old-catalog'
    assert result['SMARTLAUNDRY_ORDER_DB_PASSWORD'] == 'old-order'
    first = target.read_bytes()
    setup_env.main()
    assert target.read_bytes() == first
    assert target.stat().st_mode & 0o777 == 0o600


def test_fresh_env_uses_only_project_scoped_names(tmp_path, monkeypatch):
    monkeypatch.setattr(setup_env, '__file__', str(tmp_path / 'scripts' / 'setup_env.py'))
    setup_env.main()
    result = values(tmp_path / '.env')
    assert set(result) == {
        'SMARTLAUNDRY_POSTGRES_PASSWORD',
        'SMARTLAUNDRY_CATALOG_DB_PASSWORD',
        'SMARTLAUNDRY_ORDER_DB_PASSWORD',
    }
    assert all(len(value) >= 40 for value in result.values())
    assert (tmp_path / '.env').stat().st_mode & 0o777 == 0o600
