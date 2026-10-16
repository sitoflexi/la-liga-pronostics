"""Actualiza data.json solo: rellena resultados y crea la siguiente jornada.

Lo ejecuta la GitHub Action .github/workflows/resultados.yml cada 10 minutos con --si-toca:
solo consulta la API cuando algún partido ha podido terminar (empezó hace 1 h 45 min - 24 h y no tiene
resultado), así el resultado aparece poco después de cada partido. Además hace una pasada completa
a las 6 y a las 18 UTC (cambios de horario, jornada nueva) aunque no haya partidos.
- Resultados y estado de cada partido: TheSportsDB (gratis, sin registro).
- Calendario de respaldo para crear jornadas: openfootball/football.json.
Nunca sobrescribe un resultado que ya esté puesto (lo que mete un admin manda).

Uso: python scripts/update_results.py [data.json] [--si-toca]
"""
import datetime as dt
import json
import sys
import time
import unicodedata
import urllib.request
from zoneinfo import ZoneInfo

LEAGUE_ID = 4335  # La Liga en TheSportsDB
SEASON = "2026-2027"
OPENFOOTBALL = "https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/es.1.json"
FINISHED = {"FT", "AET", "PEN", "MATCH FINISHED"}
# estado de TheSportsDB -> cómo lo mostramos
SUSPENDED = {"PST": "aplazado", "POSTPONED": "aplazado", "CANC": "aplazado", "CANCELLED": "aplazado",
             "ABD": "suspendido", "ABANDONED": "suspendido", "SUSP": "suspendido", "INT": "suspendido"}
HALTED = set(SUSPENDED.values())

# Orden importante: las reglas más específicas primero ("Deportivo Alavés" no es el Depor).
TEAMS = [
    ("alaves", "ALA"), ("athletic", "ATH"), ("atletico", "ATM"), ("barcelona", "FCB"),
    ("espanyol", "ESP"), ("betis", "BET"), ("celta", "CEL"), ("coruna", "DEP"),
    ("elche", "ELC"), ("getafe", "GET"), ("levante", "LEV"), ("malaga", "MAL"),
    ("osasuna", "OSA"), ("rayo", "RAY"), ("racing", "RAC"), ("sociedad", "RSO"),
    ("real madrid", "RMA"), ("sevilla", "SEV"), ("valencia", "VAL"), ("villarreal", "VIL"),
    ("girona", "GIR"), ("mallorca", "MLL"), ("oviedo", "OVI"), ("valladolid", "VLL"),
    ("leganes", "LEG"), ("las palmas", "LPA"),
]


def abbr(name):
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    for key, code in TEAMS:
        if key in n:
            return code
    raise ValueError(f"Equipo desconocido: {name!r}")


def get_json(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "la-liga-pronostics-bot"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - reintenta cualquier fallo de red
            if attempt == 2:
                raise
            print(f"  reintento ({e})")
            time.sleep(5)


def round_events(n):
    """Partidos de la jornada n según TheSportsDB: {(home, away): {...}}."""
    url = f"https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id={LEAGUE_ID}&r={n}&s={SEASON}"
    out = {}
    for e in get_json(url).get("events") or []:
        try:
            key = (abbr(e["strHomeTeam"]), abbr(e["strAwayTeam"]))
        except ValueError as err:
            print(f"  aviso: {err}")
            continue
        status = (e.get("strStatus") or "").strip().upper()
        when = e.get("strTimestamp") or (e.get("dateEvent") or "") + "T" + (e.get("strTime") or "00:00:00")
        out[key] = {
            "status": status,
            "home_score": e.get("intHomeScore"),
            "away_score": e.get("intAwayScore"),
            "date": when[:19] + "Z" if when and not when.endswith("Z") else when,
        }
    return out


def openfootball_round(n):
    data = get_json(OPENFOOTBALL)
    ms = [m for m in data.get("matches", []) if m.get("round") == f"Matchday {n}"]
    ms.sort(key=lambda m: (m.get("date", ""), m.get("time", "")))
    return [{"home": abbr(m["team1"]), "away": abbr(m["team2"]), "result": None,
             "date": f"{m['date']}T{m.get('time', '00:00')}:00"} for m in ms]


def kickoff(s):
    """Fecha de un partido en UTC; sin zona horaria se entiende hora de Madrid (openfootball)."""
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=ZoneInfo("Europe/Madrid"))


def due(data, now=None):
    """¿Hace falta consultar? Hay un partido que ha podido terminar o toca la pasada de mantenimiento."""
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.hour in (6, 18):   # toda la hora: los cron de GitHub se retrasan
        return "pasada de mantenimiento"
    for j in data["jornadas"]:
        for m in j["matches"]:
            if m.get("result") or m.get("status") in HALTED or not m.get("date"):
                continue
            ago = now - kickoff(m["date"])
            if dt.timedelta(minutes=105) <= ago <= dt.timedelta(hours=24):
                return f"J{j['n']} {m['home']}-{m['away']} pudo terminar"
    return None


def main(path, only_if_due=False):
    data = json.load(open(path, encoding="utf-8"))
    if only_if_due:
        why = due(data)
        if not why:
            print("Ningún partido por terminar; no consulto")
            return
        print(f"Consulto: {why}")
    changes = []
    cache = {}

    def events(n):
        if n not in cache:
            cache[n] = round_events(n)
        return cache[n]

    # 1) Resultados de las jornadas con partidos sin resultado
    for j in data["jornadas"]:
        if all(m.get("result") for m in j["matches"]):
            continue
        ev = events(j["n"])
        for m in j["matches"]:
            e = ev.get((m["home"], m["away"]))
            if not e:
                continue
            if e["date"] and not m.get("date"):
                m["date"] = e["date"]
            if m.get("result"):
                continue
            if e["status"] in FINISHED and e["home_score"] not in (None, "") and e["away_score"] not in (None, ""):
                m["result"] = f"{int(e['home_score'])}-{int(e['away_score'])}"
                m.pop("status", None)
                changes.append(f"J{j['n']} {m['home']}-{m['away']} {m['result']}")
            elif e["status"] in SUSPENDED:
                if m.get("status") != SUSPENDED[e["status"]]:
                    m["status"] = SUSPENDED[e["status"]]
                    changes.append(f"J{j['n']} {m['home']}-{m['away']} {m['status']}")
            elif m.get("status") in HALTED:
                m.pop("status")  # vuelve a tener fecha
                changes.append(f"J{j['n']} {m['home']}-{m['away']} reprogramado")
            if e["date"] and m.get("date") != e["date"] and not m.get("result"):
                m["date"] = e["date"]  # sigue los cambios de horario

    # 2) Si en la última jornada ya no queda nada por jugar, crear la siguiente
    last = max(data["jornadas"], key=lambda j: j["n"])
    if all(m.get("result") or m.get("status") in HALTED for m in last["matches"]):
        n = last["n"] + 1
        ev = events(n)
        matches = [{"home": h, "away": a, "result": None, "date": e["date"]}
                   for (h, a), e in sorted(ev.items(), key=lambda kv: kv[1]["date"] or "")]
        if len(matches) < 10:
            print(f"  TheSportsDB solo da {len(matches)} partidos de la J{n}; uso openfootball")
            matches = openfootball_round(n)
        if matches:
            data["jornadas"].append({"n": n, "matches": matches, "preds": {}, "comodin": {}})
            changes.append(f"Nueva jornada J{n} ({len(matches)} partidos)")

    if not changes:
        print("Sin cambios")
        return
    data["updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    data["updatedBy"] = "Bot de resultados"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print("\n".join(changes))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0] if args else "data.json", only_if_due="--si-toca" in sys.argv)
