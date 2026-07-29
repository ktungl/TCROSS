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

## 開發過程
0729 
1. 刪除確認 + 儲存回饋：目前刪除計畫、刪除檔案是點了就直接執行，儲存活動/成果也沒有任何「已儲存」提示，加上確認對話框和 toast 提示
2. 檔案上傳體驗優化：拖曳上傳到資料夾區塊 + 照片資料夾顯示縮圖預覽（呼應原文「一個活動一個資料夾」的直覺操作感）
3. 活動關鍵字搜尋：目前只能用計畫/月份/缺漏篩選，加上活動名稱/地點/負責人的關鍵字搜尋
4. 計畫詳情頁：點計畫卡片可以看到該計畫底下的活動清單（目前只顯示「幾場活動」的數字）
5. 總覽儀表板：活動總數、缺漏率、依月份活動量的小圖表，作為成果報告的延伸
6. 活動複製功能：常態性活動（例如每月志工日）可以「複製一場」快速建立，不用重填欄位