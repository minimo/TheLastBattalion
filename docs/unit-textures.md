# 兵士モデルの共通テクスチャ

敵味方の全モデルで同じテクスチャ2枚と同じマテリアルを使う。描画回数は増えない。各モデルの三角形数は置き換え前以下に保つ。

- `public/assets/units/unit-albedo.png`：1024px。色のない質感（鋼・鎖帷子・革・布・木など）を4×4のセルに並べる。
- `public/assets/units/unit-mask.png`：512px。同じ配置で G が粗さ、B が金属度。

色は今までどおり頂点カラーが持ち、テクスチャを掛け合わせる。陣営色も頂点カラーなので、陣営別のテクスチャは要らない。テクスチャのセルは平均の明るさを揃えているため、縮小時に隣のセルと混ざっても色は変わらない。

目の光や矢のように質感の要らない面は白いセルを参照し、頂点カラーだけで描かれる。

## 移行状況

全12兵種と幟・矢が移行済み。幟は人間156→78前後、魔王軍240→約100、矢60→17前後の三角形に減らした。正確な数は書き出し時に表示される。

| 兵種 | 人間 | 三角形数（置き換え前） | 魔王軍 | 三角形数（置き換え前） |
|---|---|---:|---|---:|
| 歩兵 | 剣盾兵 | 608（708） | オーク | 612（624） |
| 槍兵 | 大盾の槍兵 | 654（684） | オーク | 596（612） |
| 弓兵 | 弓兵 | 538（624） | ゴブリン | 530（588） |
| 騎兵 | 騎馬槍兵 | 744（744） | オオカミ騎兵 | 777（804） |
| 補給兵 | 荷を背負う補給兵 | 548（660） | ゴブリン | 558（600） |
| 工兵 | 丸太と大槌 | 565（660） | オーク | 583（588） |

弓兵の三角形数は画面に出る分。通常時の腕と弓（106三角形）は構えの部位と入れ替わるので数えない。

## ファイル

- `scripts/blender/unit_surfaces.py`：セルの配置、粗さ・金属度、共通パレット。色の調整はここで行う。
- `scripts/blender/generate-unit-atlas.py`：テクスチャ2枚を生成する。同じ入力からは同じ画像ができる。
- `scripts/blender/export-unit.py`：全兵種共通の書き出し。UV、角度で滑らかさを分けた法線、頂点に焼き込む陰影をメッシュから自動で作る。
- `scripts/blender/unit_kit.py`：モデル生成の共通部品。
- `scripts/blender/refine-units.py`：オーク・ゴブリン・オオカミ騎兵・人間の補給兵と工兵の生成。兵種ごとにシーンを追加し、開いているファイルは保存しない。編集用データは `assets/blender/units.blend`。
- `app/render/three/unitAsset.ts`：書き出したJSONの読み込み。`app/render/three/unitMaterial.ts`：共有マテリアル。
- `assets/blender/unit-pilot-close.png`、`unit-pilot-squads.png`、`unit-humans.png`、`unit-monsters.png`、`unit-archer-poses.png`、`unit-monster-banner.png`：ゲームと同じライトと描画コードで撮った確認画像（地面は単色で、実際の地形ではない）。

## 反映の手順

テクスチャの再生成：

```sh
Blender --background --python scripts/blender/generate-unit-atlas.py
```

モデルの書き出し（`--max-triangles` は置き換え前の三角形数）：

```sh
Blender assets/blender/units.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Orc Infantry Study' --output orcInfantry --max-triangles 624
Blender assets/blender/human-infantry.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Infantry Study' --output humanInfantry --max-triangles 608
Blender assets/blender/human-pikeman.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Pikeman Study' --output humanPikeman --max-triangles 654
Blender assets/blender/human-archer.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Archer Study' --output humanArcher --max-triangles 539
Blender assets/blender/human-cavalry-textured.blend --background --python scripts/blender/export-unit.py -- --scene 'TLB Cavalry Study' --output humanCavalry --max-triangles 744
```

`units.blend` の他の兵種も、シーン名（`TLB Orc Pikeman Study` など）と出力名を変えて同じように書き出す。幟と矢（`TLB Banner Study`、`TLB Monster Banner Study`、`TLB Arrow Study`）は `--prop` を付ける。

起動中のBlenderからは、`EXPORT_ARGV` に同じ引数のリストを渡して `export-unit.py` を `exec` する。
