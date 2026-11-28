"""Offline tests for the data pipeline (run: python -m pytest tests  or  python tests/test_pipeline.py)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import common  # noqa: E402
import fetch_ships  # noqa: E402
from ais_reference import flag_from_mmsi, ship_type  # noqa: E402

POS = {"MessageType": "PositionReport",
       "MetaData": {"MMSI": 412000111, "ShipName": "LU RONG YU 123  ", "latitude": 5.0, "longitude": 132.0},
       "Message": {"PositionReport": {"Latitude": 5.0, "Longitude": 132.0, "Sog": 3.1, "Cog": 87.5,
                                      "TrueHeading": 511, "NavigationalStatus": 7, "UserID": 412000111}}}
STATIC = {"MessageType": "ShipStaticData", "MetaData": {"MMSI": 412000111},
          "Message": {"ShipStaticData": {"Name": "LU RONG YU 123", "CallSign": "BZZZ1", "ImoNumber": 0,
                                         "Type": 30, "Destination": "PALAU@@@", "MaximumStaticDraught": 4.2,
                                         "Dimension": {"A": 30, "B": 10, "C": 4, "D": 4},
                                         "Eta": {"Month": 11, "Day": 28, "Hour": 6, "Minute": 0}}}}
RESEARCH = {"MessageType": "StandardClassBPositionReport",
            "MetaData": {"MMSI": 413999000, "ShipName": "XIANG YANG HONG 03"},
            "Message": {"StandardClassBPositionReport": {"Latitude": 9.0, "Longitude": 133.0, "Sog": 10,
                                                        "Cog": 360, "TrueHeading": 120}}}
OUTSIDE = {"MessageType": "PositionReport", "MetaData": {"MMSI": 538000777, "ShipName": "BULK STAR"},
           "Message": {"PositionReport": {"Latitude": 12.0, "Longitude": 137.4, "Sog": 12, "Cog": 200,
                                          "TrueHeading": 199, "NavigationalStatus": 0}}}


def test_geo():
    assert common.in_eez(7.5, 134.5)
    assert not common.in_eez(2.0, 140.0)
    assert common.in_territorial_sea(7.34, 134.47)
    assert not common.in_territorial_sea(10.0, 135.0)


def test_reference():
    assert flag_from_mmsi(511100123) == "Palau"
    assert flag_from_mmsi("416000001") == "Taiwan"
    assert ship_type(30)[0] == "Fishing" and ship_type(55)[1] == "Law enforcement"


def test_ships_run_merges_and_flags(monkeypatch=None):
    with tempfile.TemporaryDirectory() as tmp:
        common.DATA_DIR = tmp
        os.environ.pop("PREV_BASE_URL", None)
        os.environ["AISSTREAM_API_KEY"] = "test"

        async def fake_listen(key, seconds, bbox):
            ships = {}
            for m in (POS, STATIC, RESEARCH, OUTSIDE):
                fetch_ships.handle_message(ships, m)
            return ships, 4

        orig = fetch_ships._listen
        fetch_ships._listen = fake_listen
        try:
            r = fetch_ships.run()
        finally:
            fetch_ships._listen = orig
        assert r["ok"] and r["count"] == 3, r
        import json
        data = json.load(open(os.path.join(tmp, "ships.json")))
        by = {s["mmsi"]: s for s in data["ships"]}
        f = by["412000111"]
        assert f["name"] == "LU RONG YU 123" and f["category"] == "Fishing" and f["in_eez"]
        assert f["flag"] == "China" and f["length_m"] == 40 and f["destination"] == "PALAU"
        assert f["heading"] is None and f["nav_status_label"] == "Engaged in fishing"
        assert any("Fishing vessel inside" in w for w in f["watch"])
        assert any("watch list" in w for w in by["413999000"]["watch"])
        assert by["413999000"]["cog"] is None
        assert not by["538000777"]["watch"]
        assert r["fishing_in_eez"] == 1


def test_port_calls_open_and_close():
    import json
    import port
    from datetime import datetime, timedelta, timezone
    with tempfile.TemporaryDirectory() as tmp:
        common.DATA_DIR = tmp
        os.environ.pop("PREV_BASE_URL", None)
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        ship = {"mmsi": "538000001", "name": "KYOWA FALCON", "class": "A", "category": "Cargo", "age_h": 0.1,
                "lat": 7.331, "lon": 134.455, "last_pos": now, "first_seen": now, "trail": [[7.331, 134.455, now]]}
        inbound = {"mmsi": "353000002", "name": "PACIFIC STAR", "class": "A", "category": "Tanker", "age_h": 0.2,
                   "lat": 8.5, "lon": 133.0, "sog": 12, "destination": "KOROR PALAU", "last_pos": now}
        tour = {"mmsi": "511000003", "name": "DIVE BOAT", "class": "B", "category": "Passenger", "age_h": 0.1,
                "lat": 7.331, "lon": 134.455, "last_pos": now}
        out = port.update([ship, inbound, tour])
        assert [c["name"] for c in out["in_port"]] == ["KYOWA FALCON"]
        assert out["expected"][0]["name"] == "PACIFIC STAR" and out["expected"][0]["hours_away_est"] > 5
        ship2 = {**ship, "lat": 8.2, "lon": 134.9, "destination": "GUAM"}
        out2 = port.update([ship2])
        call = out2["calls"][0]
        assert call["departed"] and call["next_destination"] == "GUAM" and not out2["in_port"]
        assert json.load(open(os.path.join(tmp, "port.json")))["calls"]


def test_tourism_parser():
    import fetch_tourism
    txt = ("Summary October 2026 visitor arrivals totaled 5,585, up by 242 visitors, or 5%, from September's 5,343. "
           "China remained the largest source market with 1,935 visitors, followed by Taiwan (873), USA/Canada (864), "
           "Japan (635), Europe (462), Australia (380), Others (346), and South Korea (90). Six of the eight markets "
           "recorded increases. Compared with October 2025, arrivals decreased by 886 visitors, or 14%. "
           "For January through October 2026, total visitor arrivals reached 69,533, an increase.")
    r = fetch_tourism.parse_report(txt)
    assert r["total"] == 5585 and r["ytd"] == 69533 and r["yoy_change"] == -886 and r["yoy_pct"] == -14.0
    assert r["markets"]["China"] == 1935 and r["markets"]["South Korea"] == 90 and sum(r["markets"].values()) == 5585
    assert r["prev_month_total"] == 5343 and fetch_tourism.month_key("Palau October 2026 Visitors") == "2026-10"


def test_airport_normaliser():
    import fetch_airport
    f = {"number": "UA 157", "callSign": "UAL157", "status": "Expected", "isCargo": False,
         "departure": {"airport": {"icao": "PGUM", "iata": "GUM", "name": "Guam"}, "scheduledTime": {"utc": "2026-11-26 01:00Z"}},
         "arrival": {"airport": {"icao": "PTRO"}, "scheduledTime": {"utc": "2026-11-26 03:05Z"}, "revisedTime": {"utc": "2026-11-26 03:20Z"}},
         "aircraft": {"reg": "N12345", "model": "Boeing 737-800"}, "airline": {"name": "United Airlines", "iata": "UA"}}
    n = fetch_airport._norm(f, "arrival")
    assert n["other_iata"] == "GUM" and n["scheduled"] == "2026-11-26 03:05Z" and n["revised"] == "2026-11-26 03:20Z"
    assert n["airline"] == "United Airlines" and n["aircraft"] == "Boeing 737-800"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
