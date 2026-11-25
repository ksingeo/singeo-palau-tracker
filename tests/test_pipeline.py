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


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
