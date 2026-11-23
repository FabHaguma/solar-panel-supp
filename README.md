# Solar supplier checks

Kigali supplier directory and visit tracker. The initial SQLite database imports 18 shop and branch entries, 72 branch-specific panel and sourcing records, and 24 components from the project checklist.

## Deploy to solpan.haguma.com

**Caddy upstream** `frontend_solar_panel_supp:8080` on the existing `caddy_network`. Run the following on the VPS from the parent directory you want to use. For an existing checkout, enter `solar-panel-supp` and run `git pull --ff-only` instead of cloning.

```sh
git clone https://github.com/FabHaguma/solar-panel-supp.git
cd solar-panel-supp
if [ ! -f .env ]; then
  (umask 077; printf 'SOLPAN_USER=admin\nSOLPAN_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env)
fi
docker-compose up -d --build
```

Add this site to the shared Caddyfile loaded by the Caddy container on `caddy_network`.

```caddyfile
solpan.haguma.com {
    reverse_proxy frontend_solar_panel_supp:8080
}
```

Use the existing container and its mounted Caddyfile path. The following VPS commands identify them if needed. Substitute their actual values for the placeholders before validating and reloading.

```sh
docker network inspect caddy_network --format '{{range .Containers}}{{println .Name}}{{end}}'
docker inspect <caddy-container> --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
docker exec <caddy-container> caddy validate --adapter caddyfile --config <container-caddyfile>
docker exec <caddy-container> caddy reload --adapter caddyfile --config <container-caddyfile>
```

Open [solpan.haguma.com](https://solpan.haguma.com) and sign in with the credentials in the VPS app's `.env`. Check startup with `docker-compose ps` and `curl -fsS https://solpan.haguma.com/healthz`.

To update, run `git pull --ff-only` and `docker-compose up -d --build` from the VPS app directory. To tag images with the release commit, run `SOLPAN_TAG="$(git rev-parse --short HEAD)" docker-compose up -d --build`. To stop, run `docker-compose down`. The named volume `solar_panel_supp_data` keeps the database across both commands.

The Components release adds two tables on startup and preserves the shop, owner and panel records. Take a SQLite snapshot before this first update using the command below. The earlier release only supports schema 1. After the upgrade, use a forward fix to keep new records if a rollback is needed.

## Use on a visit

1. Open the shop and use **Record visit** to save the date and shop notes.
2. Use **Check model** for availability, the exact model code, and programming. Use **Add model** for something you find in the shop that was missing from the research.
3. Use **Update contact** to record the owner or decision-maker's business contact, where you got it, and any follow-up. The public business contact is shown separately.
4. Open **Components** to check the project parts. Use **Vendor check** to record availability, a price in RWF, the vendor's phone and location, and comments. Add another check for each vendor you compare. The planned budget is shown above the actual quotes.
5. Use **Download JSON** from either tab to export the complete directory and the current checks. The file includes saved contact details and notes.

For a plain PV module use **N/A (panel only)**. For a kit or smart module, record the electronics and whether their settings are adjustable as sold.

## Local preview

From the repository root, run `npm run dev` with Node.js 22.15 or newer and open [http://127.0.0.1:3000](http://127.0.0.1:3000). The loopback preview works without credentials and writes to `data/solpan.sqlite`. Deployment requires a username and password and uses the VPS volume. The application has no npm dependencies.

## SQLite backup and restore

Run from the VPS app folder. The backup command takes a consistent snapshot while the app is running.

```sh
umask 077
backup="solpan-$(date +%Y%m%d-%H%M%S).sqlite"
cid="$(docker-compose ps -q backend_solar_panel_supp)"
docker-compose exec -T backend_solar_panel_supp node -e 'const {DatabaseSync}=require("node:sqlite"); const d=new DatabaseSync(process.env.DB_PATH); d.exec("PRAGMA busy_timeout=5000"); d.prepare("VACUUM INTO ?").run("/tmp/"+process.argv[1]); d.close()' "$backup"
docker cp "$cid:/tmp/$backup" "./$backup"
docker exec "$cid" rm "/tmp/$backup"
chmod 600 "$backup"
```

Restore during maintenance. Keep a separate backup of the current database first.

```sh
docker-compose stop backend_solar_panel_supp
docker-compose run --rm -T --no-deps backend_solar_panel_supp sh -c 'cat > /data/restore.sqlite && mv /data/restore.sqlite /data/solpan.sqlite && rm -f /data/solpan.sqlite-wal /data/solpan.sqlite-shm' < ./SELECTED-BACKUP.sqlite
docker-compose up -d
```
