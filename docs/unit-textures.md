# 兵士モデルの共通テクスチャ

敵味方の全モデルで同じテクスチャ2枚と同じマテリアルを使う。描画回数は増えない。各モデルの三角形数は置き換え前以下に保つ。

- `public/assets/units/unit-albedo.png`：1024px。色のない質感（鋼・鎖帷子・革・布・木など）を4×4のセルに並べる。
- `public/assets/units/unit-mask.png`：512px。同じ配置で G が粗さ、B が金属度。

色は今までどおり頂点カラーが持ち、テクスチャを掛け合わせる。陣営色も頂点カラーなので、陣営別のテクスチャは要らない。テクスチャのセルは平均の明るさを揃えているため、縮小時に隣のセルと混ざっても色は変わらない。

UVを持たないモデルは白いセルを参照し、頂点カラーだけで描かれる。そのため1体ずつ移行できる。

## 移行状況

| モデル | 状態 |
|---|---|
| 人間の歩兵、オーク歩兵 | 移行済み（試作） |
| 人間の槍兵・弓兵・騎兵 | 形状はBlender製、テクスチャは未適用 |
| その他・幟・矢 | `unitModels.ts` のプリミティブのまま |

## ファイル

- `scripts/blender/unit_surfaces.py`：セルの配置、粗さ・金属度、共通パレット。色の調整はここで行う。
- `scripts/blender/generate-unit-atlas.py`：テクスチャ2枚を生成する。同じ入力からは同じ画像ができる。
- `scripts/blender/export-unit.py`：全兵種共通の書き出し。UV、角度で滑らかさを分けた法線、頂点に焼き込む陰影をメッシュから自動で作る。
- `scripts/blender/unit_kit.py`：モデル生成の共通部品。
- `scripts/blender/refine-orc-infantry.py`：オーク歩兵の生成。開いているファイルは保存しない。
- `app/render/three/unitAsset.ts`：書き出したJSONの読み込み。`app/render/three/unitMaterial.ts`：共有マテリアル。
- `assets/blender/unit-pilot-close.png`、`unit-pilot-squads.png`：ゲームと同じライトと描画コードで撮った確認画像（地面は単色で、実際の地形ではない）。

## 反映の手順

テクスチャの再生成：

```sh
Blender --background --python scripts/blender/generate-unit-atlas.py
```

モデルの書き出し（`--max-triangles` は置き換え前の三角形数）：

```sh
Blender assets/blender/orc-infantry.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Orc Infantry Study' --output orcInfantry --max-triangles 624
Blender assets/blender/human-infantry.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Infantry Study' --output humanInfantry --max-triangles 608
```

起動中のBlenderからは、`EXPORT_ARGV` に同じ引数のリストを渡して `export-unit.py` を `exec` する。
