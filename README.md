# TCROSS 活動紀錄平台

Vue 3 + TypeScript + Vite 專案，資料層使用 [Parse Platform](https://parseplatform.org/)（後端建議用 [Back4App](https://www.back4app.com/)）。

`TCROSS.html` 是最早的單檔原型（vanilla JS + localStorage），保留在 repo 內作為畫面與邏輯的對照，不再維護。

## 開發設定

1. 安裝套件：

   ```bash
   npm install
   ```

2. 到 Back4App 建立一個 App，取得 **App ID**、**JavaScript Key**、**Server URL**（通常是 `https://parseapi.back4app.com/`）。

3. 複製環境變數檔並填入上一步拿到的值：

   ```bash
   cp .env.example .env
   ```

4. 啟動開發伺服器：

   ```bash
   npm run dev
   ```

## 其他指令

- `npm run build` — 型別檢查（`vue-tsc`）+ 產生正式版建置
- `npm run preview` — 本地預覽建置結果

## 資料結構（Parse Classes）

- **Plan**：`name`
- **Activity**：`name` / `date` / `place` / `owner` / `headcount` / `plans`（對應多個 Plan）/ `summary` / `kpis` / `photoFiles` / `audioFiles` / `videoFiles` / `docFiles`

在 `.env` 尚未填入有效憑證前，畫面可以正常開啟與切換頁面，但清單會是空的（連線 Parse 失敗時會在畫面上方顯示錯誤提示）。
