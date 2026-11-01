# UI寸法の調査

現在のVueコンポーネントのCSSから確認。ブラウザ上の実測値ではなく、高さは表示内容・画面サイズに依存する。

| UI | 通常の幅 | 狭い画面 | 高さ |
| --- | --- | --- | --- |
| 部隊情報・部隊一覧 | 236px | 900px以下: 200px、550px以下: 最大260px（画面幅−20px） | 内容による。親領域は上112px・下150pxの間 |
| 長押しメニュー | min-width: 200px（外枠は境界線を加えて最低202px） | 同じ | 内容による |
| 全軍メニュー | 内側min-width: 220px（ポップアップ境界線込み最低222px） | 同じ | 内容による |
| 軍の内訳ポップアップ | 224px（親の幅200px＋左右padding各12px） | 900px以下: 162px、550px以下: 108px | 兵種・予備兵・逃走などの行数による |
| 戦況・操作メニュー | min(380px, 画面幅−32px) | 550px以下: 左右8px | 最大: 画面高−240px、550px以下: 画面高−200px |
| 部隊編成 | min(540px, 画面幅−32px) | 同じ | 上96px・下20pxの間を上限。550px以下: 上84px・下16px |
| 勝敗ダイアログ | 内容幅＋左右padding各2.5rem＋境界線 | 固定幅指定なし | 内容高＋上下padding各2rem＋境界線 |

調査元: app/components/SquadPanel.vue, GameCanvas.vue, ArmyMenu.vue, CommandBar.vue, ArmyStatus.vue, BattleMenu.vue, DeploymentEditor.vue。app/app.vueには全要素のbox-sizing変更はない。

小型ウィンドウ用画像: public/images/ui/parchment-window-small.png。巻き・軸なしの平らな羊皮紙、背景透過、文字なし。既存の手巻き風画像に紙色と縁の質感を合わせた。

## ゲームへの適用

app/assets/styles/parchment.css の border-image で枠を伸縮する。上記の表は画像適用前の調査値。固定幅の外寸は維持し、巻きのある大型パネルでは上下に装飾用の領域を確保する。

- 一枚の羊皮紙: 部隊情報・軍の内訳・全軍メニュー・長押しメニュー・勝敗ダイアログ。
- 手巻き風: 部隊一覧・部隊編成・戦況/操作メニュー（scroll-window-handrolled.png）。部隊一覧は狭い幅に合わせて上下32px/34px・左右10pxの枠とし、内容部分をスクロールできる。
- 紙の上の文字・ボタン・ゲージは茶色を基本に、陣営色は濃い青/赤に調整。
