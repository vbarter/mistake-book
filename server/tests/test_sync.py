"""云同步：推送 / 拉取 / 冲突 / 删除 / 照片直传（本地存储代替 COS）/ 合并账号 / 注销清理。"""
from datetime import datetime, timedelta

import pytest

from app.extensions import db
from app.models import SyncFolder, SyncPage, SyncPaper, SyncState


def _login(client, phone):
    r = client.post("/api/auth/code", json={"phone": phone, "purpose": "register"})
    r = client.post("/api/auth/register", json={"phone": phone, "code": r.get_json()["devCode"]})
    return {"Authorization": f"Bearer {r.get_json()['token']}"}, r.get_json()["user"]["id"]


T1, T2, T3 = "2026-11-09T10:00:00.000Z", "2026-11-09T11:00:00.000Z", "2026-11-09T12:00:00.000Z"
DIG = {"sheets": [{"label": "第 1 页"}], "questions": [{"index": 0, "mark": "wrong", "stemText": "3+4=?"}]}


def _seed(client, auth):
    body = {
        "folders": [{"id": "f1", "name": "11月9日 试卷", "createdAt": T1, "updatedAt": T1}],
        "papers": [{"id": "p1", "folderId": "f1", "name": "第 1 张", "subject": "math", "createdAt": T1, "updatedAt": T1, "scannedAt": T1, "digitized": DIG}],
        "pages": [{"id": "g1", "paperId": "p1", "position": 0, "width": 2400, "height": 1800, "sha": "abc", "createdAt": T1, "updatedAt": T1}],
    }
    r = client.post("/api/sync/push", json=body, headers=auth)
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def test_push_then_pull_on_another_device(client, auth):
    out = _seed(client, auth)
    assert [a["id"] for a in out["applied"]["papers"]] == ["p1"] and out["rev"] == 3
    assert not any(out["rejected"].values())

    # 另一台设备第一次全量拉
    r = client.get("/api/sync/changes?since=0", headers=auth).get_json()
    assert r["rev"] == 3 and r["more"] is False
    paper = r["papers"][0]
    assert paper["digitized"] == DIG and paper["scannedAt"] == T1 and paper["subject"] == "math" and paper["digitizedHash"]
    page = r["pages"][0]
    assert page["files"] == {"original": False, "erased": False, "thumb": False} and page["sha"] == "abc"
    assert r["folders"][0]["name"] == "11月9日 试卷"

    # 没有新变更
    r = client.get("/api/sync/changes?since=3", headers=auth).get_json()
    assert r == {"folders": [], "papers": [], "pages": [], "rev": 3, "more": False}


def test_changes_paginate_by_rev(client, auth):
    _seed(client, auth)
    seen, since = [], 0
    for _ in range(5):
        r = client.get(f"/api/sync/changes?since={since}&limit=1", headers=auth).get_json()
        seen += [x["id"] for k in ("folders", "papers", "pages") for x in r[k]]
        since = r["rev"]
        if not r["more"]:
            break
    assert seen == ["f1", "p1", "g1"]


def test_conflict_newer_wins_and_loser_gets_current(client, auth):
    _seed(client, auth)
    # 设备 A 基于 rev 2 改名
    r = client.post("/api/sync/push", json={"papers": [{"id": "p1", "folderId": "f1", "baseRev": 2, "name": "期中", "updatedAt": T2}]}, headers=auth).get_json()
    assert r["applied"]["papers"][0]["rev"] == 4
    # 设备 B 也基于 rev 2，但改得更早 → 输，拿到 A 的版本
    r = client.post("/api/sync/push", json={"papers": [{"id": "p1", "folderId": "f1", "baseRev": 2, "name": "单元测", "updatedAt": "2026-11-09T10:30:00.000Z"}]}, headers=auth).get_json()
    rej = r["rejected"]["papers"][0]
    assert rej["reason"] == "conflict" and rej["current"]["name"] == "期中"
    # 没带 digitized 的推送不动电子版
    assert rej["current"]["digitized"] == DIG
    # 设备 C 基于旧版本但改得更晚 → 赢
    r = client.post("/api/sync/push", json={"papers": [{"id": "p1", "folderId": "f1", "baseRev": 2, "name": "月考", "updatedAt": T3}]}, headers=auth).get_json()
    assert r["applied"]["papers"]


def test_delete_folder_cascades_and_newer_edit_revives(client, auth, app):
    _seed(client, auth)
    r = client.post("/api/sync/push", json={"folders": [{"id": "f1", "baseRev": 1, "deleted": True, "updatedAt": T2}]}, headers=auth).get_json()
    assert r["applied"]["folders"]
    ch = client.get("/api/sync/changes?since=3", headers=auth).get_json()
    assert ch["folders"][0]["deleted"] and ch["papers"][0]["deleted"] and ch["pages"][0]["deleted"]
    # 全量拉不带删除标记
    assert client.get("/api/sync/changes?since=0", headers=auth).get_json()["papers"] == []

    # 另一台设备离线时往这个文件夹加了照片，改得比删除早 → 不能放
    late = {"pages": [{"id": "g2", "paperId": "p1", "updatedAt": "2026-11-09T10:30:00.000Z"}]}
    r = client.post("/api/sync/push", json=late, headers=auth).get_json()
    assert r["rejected"]["pages"][0]["reason"] == "parent_deleted"
    # 改得比删除晚 → 试卷和文件夹恢复
    later = {"pages": [{"id": "g2", "paperId": "p1", "updatedAt": T3}]}
    r = client.post("/api/sync/push", json=later, headers=auth).get_json()
    assert r["applied"]["pages"]
    with app.app_context():
        assert not db.session.get(SyncPaper, "p1").deleted and not db.session.get(SyncFolder, "f1").deleted


def test_invalid_and_foreign_records_rejected(client, auth):
    _seed(client, auth)
    other, _ = _login(client, "13900000001")
    r = client.post("/api/sync/push", json={"papers": [{"id": "p1", "folderId": "f1", "name": "偷改", "updatedAt": T3}]}, headers=other).get_json()
    assert r["rejected"]["papers"][0]["reason"] == "invalid"
    r = client.post("/api/sync/push", json={"papers": [{"id": "px", "folderId": "nope", "updatedAt": T3}], "folders": [{"id": "../x"}]}, headers=other).get_json()
    assert r["rejected"]["papers"][0]["reason"] == "missing_parent" and r["rejected"]["folders"][0]["reason"] == "invalid"
    assert client.get("/api/sync/changes?since=0", headers=other).get_json()["papers"] == []
    assert client.post("/api/sync/push", json={"papers": "x"}, headers=auth).status_code == 400


def test_photo_upload_download_with_local_storage(client, auth):
    _seed(client, auth)
    r = client.post("/api/sync/upload-urls", json={"files": [{"pageId": "g1", "kind": "original"}, {"pageId": "g1", "kind": "erased"}, {"pageId": "nope", "kind": "thumb"}]}, headers=auth).get_json()
    assert len(r["urls"]) == 1 and len(r["missing"]) == 2  # 没擦过不能传擦除版
    put = r["urls"][0]
    assert put["url"].startswith("/api/sync/blob/") and put["method"] == "PUT"

    # 没传就确认 → missing
    assert client.post("/api/sync/uploaded", json={"files": [{"pageId": "g1", "kind": "original"}]}, headers=auth).get_json()["missing"]
    assert client.put(put["url"], data=b"\xff\xd8jpeg", headers=put["headers"]).status_code == 200
    assert client.put(put["url"].replace("/blob/", "/blob/x"), data=b"1").status_code == 403
    done = client.post("/api/sync/uploaded", json={"files": [{"pageId": "g1", "kind": "original"}]}, headers=auth).get_json()
    assert done["done"][0]["rev"] == 4

    # 别的设备拉到照片有原图了，要下载链接
    ch = client.get("/api/sync/changes?since=3", headers=auth).get_json()
    assert ch["pages"][0]["files"]["original"] is True
    d = client.post("/api/sync/download-urls", json={"files": [{"pageId": "g1", "kind": "original"}, {"pageId": "g1", "kind": "thumb"}]}, headers=auth).get_json()
    assert len(d["urls"]) == 1 and d["missing"] == [{"pageId": "g1", "kind": "thumb"}]
    got = client.get(d["urls"][0]["url"])
    assert got.status_code == 200 and got.data == b"\xff\xd8jpeg"
    # 上传链接不能拿来下载
    assert client.get(put["url"]).status_code == 403

    # 擦除版：记录先带上 erased，再传文件；旧的擦除版确认会被拒
    client.post("/api/sync/push", json={"pages": [{"id": "g1", "paperId": "p1", "baseRev": 4, "erased": T2, "updatedAt": T2, "width": 2400, "height": 1800}]}, headers=auth)
    up = client.post("/api/sync/upload-urls", json={"files": [{"pageId": "g1", "kind": "erased"}]}, headers=auth).get_json()["urls"][0]
    client.put(up["url"], data=b"erased")
    stale = client.post("/api/sync/uploaded", json={"files": [{"pageId": "g1", "kind": "erased", "erased": T1}]}, headers=auth).get_json()
    assert stale["missing"][0]["reason"] == "stale"
    ok = client.post("/api/sync/uploaded", json={"files": [{"pageId": "g1", "kind": "erased", "erased": T2}]}, headers=auth).get_json()
    assert ok["done"]
    page = client.get("/api/sync/changes?since=0", headers=auth).get_json()["pages"][0]
    assert page["files"]["erased"] is True and page["erased"] == T2

    status = client.get("/api/sync/status", headers=auth).get_json()
    assert status["storage"] == "local" and status["pages"] == 1 and status["photoBytes"] == 6


def test_delete_cloud_data_and_account(client, auth, app):
    import os

    _seed(client, auth)
    put = client.post("/api/sync/upload-urls", json={"files": [{"pageId": "g1", "kind": "original"}]}, headers=auth).get_json()["urls"][0]
    client.put(put["url"], data=b"jpeg")
    root = os.path.join(app.config["UPLOAD_DIR"], "sync")
    assert any(files for _, _, files in os.walk(root))

    r = client.delete("/api/sync/data", headers=auth).get_json()
    assert r["rev"] == 4  # 版本号不回退
    with app.app_context():
        assert SyncPage.query.count() == 0 and not any(files for _, _, files in os.walk(root))

    _seed(client, auth)
    assert client.delete("/api/auth/me", headers=auth).status_code == 200
    with app.app_context():
        assert SyncPaper.query.count() == 0 and SyncState.query.count() == 0


def test_merge_moves_records_to_target(client, auth, app):
    from app.routes.sync import merge_user_sync

    _seed(client, auth)
    other, other_id = _login(client, "13900000002")
    client.post("/api/sync/push", json={"folders": [{"id": "f9", "name": "我的", "updatedAt": T1}]}, headers=other)
    with app.app_context():
        source_id = db.session.get(SyncFolder, "f1").user_id
        assert merge_user_sync(source_id, other_id) == 3
        db.session.commit()
    ch = client.get("/api/sync/changes?since=1", headers=other).get_json()
    assert {x["id"] for x in ch["folders"]} == {"f1"} and ch["papers"][0]["id"] == "p1" and ch["rev"] == 4
    with app.app_context():
        assert db.session.get(SyncPage, "g1").owner_id == source_id  # 照片文件还在原来的目录


def test_sync_switch_off(client, auth, app):
    app.config["SYNC_ENABLED"] = False
    assert client.get("/api/sync/changes", headers=auth).status_code == 503
    health = client.get("/api/health").get_json()
    assert health["sync"] is False and health["storage"] == "local:online"


def test_purge_old_tombstones(client, auth, app):
    import sys, os

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    from sync_purge import purge

    _seed(client, auth)
    client.post("/api/sync/push", json={"folders": [{"id": "f1", "baseRev": 1, "deleted": True, "updatedAt": T2}]}, headers=auth)
    with app.app_context():
        assert purge(30) == {"pages": 0, "papers": 0, "folders": 0}
        for model in (SyncFolder, SyncPaper, SyncPage):
            model.query.update({"server_updated_at": datetime.now() - timedelta(days=31)})
        db.session.commit()
        assert purge(30) == {"pages": 1, "papers": 1, "folders": 1}
        assert SyncPage.query.count() == 0


def test_cos_provider_selected_when_configured(app):
    from app import storage

    cfg = {"STORAGE_PROVIDER": "", "COS_SECRET_ID": "AKID", "COS_SECRET_KEY": "k", "COS_BUCKET": "zhicuoben-data-1250000000", "COS_REGION": "ap-shanghai"}
    assert storage.provider_name(cfg) == "cos"
    assert storage.provider_name({**cfg, "COS_SECRET_KEY": ""}) == "local"
    assert storage.provider_name({**cfg, "STORAGE_PROVIDER": "local"}) == "local"
    pytest.importorskip("qcloud_cos")
    store = storage.CosStorage("ap-shanghai", "zhicuoben-data-1250000000", "AKID", "k", 900)
    url = store.presign(storage.object_key("u1", "g1", "erased"), "PUT")
    assert url.startswith("https://zhicuoben-data-1250000000.cos.ap-shanghai.myqcloud.com/u/u1/p/g1~erased.jpg?") and "q-signature=" in url
