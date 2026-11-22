# NGINX reverse proxy

## Overview

NGINX is the private TLS front door for the storage host. It terminates HTTPS for:

- Elasticsearch: `https://es.<base-domain>` → `https://127.0.0.1:9200`
- Garage S3: `https://s3.<base-domain>` → `http://127.0.0.1:3900`

PostgreSQL and MariaDB are not HTTP services and are not proxied. They keep their native TLS listeners.

## Tested platform

- AlmaLinux 10 x86_64
- NGINX 1.26.3 from AlmaLinux AppStream
- Certbot 5.10.0 and `certbot-dns-cloudflare` 5.10.0

## Exposure model

The server is privately accessible only.

- NGINX listens on port 443.
- `nginx_allowed_cidrs` must contain private or VPN source networks.
- `0.0.0.0/0` and `::/0` are rejected.
- Port 80 is not opened and is not used for ACME.
- Certificates are issued with the DNS-01 challenge, so no inbound challenge path is required.
- The default TLS server returns `444` for unknown hostnames.

## Certificates

### Let's Encrypt (production)

`nginx_certificate_mode: letsencrypt` installs a pinned Certbot virtualenv and uses the Cloudflare DNS plugin.

Required:

```yaml
nginx_letsencrypt_email: "ops@example.com"
nginx_cloudflare_api_token: "{{ secret_nginx_cloudflare_api_token }}"
nginx_base_domain: "example.com"
```

The Cloudflare API token should be scoped to the zone and allow:

- Zone / Zone / Read
- Zone / DNS / Edit

The token is written to `/etc/letsencrypt/cloudflare.ini` with mode `0600`, owned `root`, and `no_log`/`diff: false`.

Certbot creates the certificate under `/etc/letsencrypt/live/storage-host`. A deploy hook copies the chain and key into `/etc/nginx/tls` and reloads NGINX. Renewal runs twice daily through `certbot-renew.timer`.

### Generated (development and CI)

`nginx_certificate_mode: generated` creates a local CA and certificate for `es.<base>`/`s3.<base>` under `/etc/nginx/tls`. This allows offline NGINX and proxy testing without Cloudflare or public DNS. Verification uses the generated CA.

## Variables

| Variable | Default | Description |
|---|---|---|
| `nginx_version` | required | NGINX version from inventory |
| `nginx_base_domain` | required | Base domain for service hostnames |
| `nginx_certificate_mode` | `letsencrypt` | `letsencrypt` or `generated` |
| `nginx_cert_name` | `storage-host` | Certbot certificate name |
| `nginx_elasticsearch_host` | `es.<base>` | Elasticsearch hostname |
| `nginx_s3_host` | `s3.<base>` | Garage S3 hostname |
| `nginx_enable_elasticsearch` | `true` | Publish the Elasticsearch vhost |
| `nginx_enable_s3` | `true` | Publish the Garage vhost |
| `nginx_listen_address` | `0.0.0.0` | Listener address; firewall restricts access |
| `nginx_allowed_cidrs` | required | Private/VPN CIDRs allowed to reach 443 |
| `nginx_manage_firewall` | common firewall setting | Manage the 443 rich rules |
| `nginx_verify_upstreams` | `true` | Probe ES/S3 after deployment |
| `nginx_elasticsearch_upstream` | `https://127.0.0.1:9200` | Elasticsearch upstream |
| `nginx_s3_upstream` | `http://127.0.0.1:3900` | Garage S3 upstream |
| `nginx_elasticsearch_ca_source` | `/etc/elasticsearch/certs/ca.crt` | ES CA copied for upstream verification |
| `nginx_letsencrypt_email` | required for LE | ACME account email |
| `nginx_cloudflare_api_token` | required for LE | Scoped Cloudflare token from SOPS |

## Elasticsearch upstream

NGINX verifies the Elasticsearch HTTP certificate:

- CA copied to `/etc/nginx/tls/elasticsearch-ca.crt`
- `proxy_ssl_verify on`
- `proxy_ssl_name 127.0.0.1`
- Client authentication remains end-to-end: Elasticsearch still returns `401` without credentials.

The external request body limit defaults to `100m`.

## Garage S3 upstream

- NGINX preserves the `Host` header and path.
- Clients must use path-style addressing.
- `client_max_body_size 0`, request buffering off, and long timeouts support large snapshot uploads.
- S3 AWS SDK clients must disable aws-chunked trailer checksums for Garage 2.5 compatibility, just as Elasticsearch does with `disable_chunked_encoding: true`.
- Elasticsearch snapshots continue to use the loopback endpoint and do not depend on NGINX.

## SELinux

The role:

- Labels `/etc/nginx/tls` as `httpd_config_t`.
- Labels the Elasticsearch and Garage upstream ports as `http_port_t` so the `httpd_t` domain can connect.
- Verifies on a real AlmaLinux 10 host, because Docker cannot exercise `httpd_t` network policy.

## Verification

- `nginx -t`
- Service state
- Certificate and key presence, key mode, and expiry
- Elasticsearch vhost returns `401` without credentials
- Garage S3 vhost rejects anonymous access with `403` or `404`
- Certbot renewal timer is enabled in Let's Encrypt mode
- Generated mode uses the generated CA; Let's Encrypt mode uses the system CA bundle

## Troubleshooting

| Symptom | Check |
|---|---|
| NGINX will not start | `nginx -t`, `journalctl -u nginx` |
| Certbot DNS challenge fails | Cloudflare token scope, zone name, outbound HTTPS |
| Certificate files unreadable | `/etc/nginx/tls` contexts, key mode, SELinux AVCs |
| Elasticsearch proxy 502 | ES CA copy, `proxy_ssl_name`, ES listener |
| S3 proxy signature errors | Path-style addressing, Host header, SDK chunked/checksum settings |
| Renewal does not run | `systemctl list-timers`, `journalctl -u certbot-renew` |
