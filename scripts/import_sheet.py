"""Import the 26/27 JORNADES tab (grid JSON from the Sheets API) into data.json.

Usage: python scripts/import_sheet.py <grid.json> <out data.json>
The comodín is the cell whose font is not Arial (the sheet uses Gravitas One).
"""
import json, re, sys

grid = json.load(open(sys.argv[1], encoding="utf-8"))
rows = grid["sheets"][0]["data"][0]["rowData"]

def cells(r):
    out = []
    for v in r.get("values", []):
        out.append(((v.get("formattedValue") or "").strip(),
                    v.get("effectiveFormat", {}).get("textFormat", {}).get("fontFamily", "Arial")))
    return out + [("", "Arial")] * (12 - len(out))

def score(s):
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", s)
    return f"{m.group(1)}-{m.group(2)}" if m else None

jornadas, cur, players = [], None, []
for r in rows:
    c = cells(r)
    label = c[0][0]
    if label.upper().startswith("JORNADA"):
        matches = []
        for txt, _ in c[1:11]:
            home, away = [t.strip() for t in txt.split("-")]
            matches.append({"home": home, "away": away, "result": None})
        cur = {"n": len(jornadas) + 1, "matches": matches, "preds": {}, "comodin": {}, "_sheetPts": {}}
        jornadas.append(cur)
    elif cur and label.upper() == "RESULTAT FINAL":
        for i, (txt, _) in enumerate(c[1:11]):
            cur["matches"][i]["result"] = score(txt)
    elif cur and label and label.upper() != "LLEGENDA:" and c[1][0] != "LLEGENDA:":
        name = label.upper().strip()
        if name not in players:
            players.append(name)
        preds = [score(t) for t, _ in c[1:11]]
        if any(preds):
            cur["preds"][name] = preds
            com = [i for i, (_, f) in enumerate(c[1:11]) if f != "Arial"]
            if com:
                cur["comodin"][name] = com[0]
        if c[11][0]:
            cur["_sheetPts"][name] = int(c[11][0])
    elif not label:
        pass

json.dump({"jornadas": jornadas, "players": players}, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for j in jornadas:
    print(j["n"], len(j["preds"]), "preds,", len(j["comodin"]), "comodines,", sum(m["result"] is not None for m in j["matches"]), "resultados")
