# Install your own TLS certificate

**Who this is for:** the person who installed the appliance. No engineering
knowledge is assumed.

**When to do it:** before the appliance is used for real work. Until you do,
the appliance uses a certificate it generated for itself, and every browser
will warn you about it.

---

## Why the warning appears, and why it matters

At first start the appliance generates a **self-signed** certificate. That
gives you encryption — traffic between your browser and the appliance is
scrambled — but it does **not** give you proof of identity. Nothing vouches
for the certificate except the appliance itself, so your browser cannot tell
the difference between the real appliance and someone on the network
impersonating it.

Clicking through the warning once is reasonable during installation. Leaving
it in place permanently trains your team to click through certificate
warnings, which is exactly the habit an attacker on your network relies on.

## What you need

Two files from whoever issues certificates in your organisation (usually the
internal certificate authority run by IT):

| File         | What it is                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `server.crt` | The certificate, in PEM format. If you were given a separate intermediate/chain file, append it to the end of this file. |
| `server.key` | The matching private key, in PEM format, **not** password-protected.                                                     |

Ask for the certificate to be issued for the name people will actually type
into the browser — the appliance's hostname or its IP address. If it is
issued for a different name, the browser warning will not go away.

## Steps

Run these on the appliance host, from the `deploy/compose` directory.

1. **Copy your two files onto the host**, for example into `/tmp/newcert/`.

2. **Check the key is not password-protected.** This must print `RSA key ok`
   or `EC key ok` without prompting you for anything:

   ```
   openssl pkey -in /tmp/newcert/server.key -noout -check
   ```

3. **Check the certificate and key actually match.** These two commands must
   print the _same_ hash. If they differ, you have been given a mismatched
   pair — go back to whoever issued them.

   ```
   openssl x509 -noout -modulus -in /tmp/newcert/server.crt | openssl sha256
   openssl pkey  -noout -modulus -in /tmp/newcert/server.key | openssl sha256
   ```

4. **Install them into the appliance's TLS volume:**

   ```
   docker compose cp /tmp/newcert/server.crt tls-init:/etc/nginx/tls/server.crt
   docker compose cp /tmp/newcert/server.key tls-init:/etc/nginx/tls/server.key
   docker compose run --rm --entrypoint /bin/sh tls-init -c \
     'chown 101:0 /etc/nginx/tls/server.key /etc/nginx/tls/server.crt && \
      chmod 600 /etc/nginx/tls/server.key && chmod 644 /etc/nginx/tls/server.crt'
   ```

5. **Restart the panel:**

   ```
   docker compose restart web
   ```

6. **Securely delete your copies from the host:**

   ```
   shred -u /tmp/newcert/server.key && rm -f /tmp/newcert/server.crt
   ```

## Confirm it worked

Open the panel in a browser. You should see no certificate warning, and the
padlock should show your organisation's certificate authority as the issuer.

From the host you can check the same thing without a browser — this should
print your organisation's CA, not `CN=xenitex-appliance`:

```
echo | openssl s_client -connect 127.0.0.1:8443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

## If the panel does not come back

Check what nginx said:

```
docker compose logs --tail=50 web
```

| What the log says                                   | What it means                                          | What to do                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `SSL_CTX_use_PrivateKey ... key values mismatch`    | The certificate and key are not a pair.                | Redo step 3; get a matching pair.                                                                                                    |
| `cannot load certificate key ... bad password read` | The key is password-protected.                         | Ask for an unencrypted key, or remove the passphrase: `openssl pkey -in server.key -out server-nopass.key`.                          |
| `Permission denied` on the key                      | Ownership was not applied.                             | Re-run the `chown`/`chmod` command in step 4.                                                                                        |
| `PEM_read_bio_X509 ... no start line`               | The file is not PEM (it may be PKCS#12/`.pfx` or DER). | Convert it: `openssl pkcs12 -in cert.pfx -out server.crt -nokeys` and `openssl pkcs12 -in cert.pfx -out server.key -nocerts -nodes`. |

**To get back to a working panel immediately**, delete the files you
installed and let the appliance regenerate its self-signed certificate. You
will get the browser warning back, but the panel will start:

```
docker compose run --rm --entrypoint /bin/sh tls-init -c 'rm -f /etc/nginx/tls/server.crt /etc/nginx/tls/server.key'
docker compose up -d tls-init
docker compose restart web
```

## Renewal

Certificates expire. Repeat these steps with the new files before the expiry
date. To check when the current one expires:

```
echo | openssl s_client -connect 127.0.0.1:8443 2>/dev/null | openssl x509 -noout -enddate
```

Nothing about the appliance's data or configuration changes when you replace
a certificate — it is only the identity the panel presents to browsers.
