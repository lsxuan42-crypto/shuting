# 外部主機部署說明

這個候位系統是 Node.js 網站，可以放到支援 Node.js 或 Docker 的外部主機。

## 必要設定

- 啟動指令：`npm start`
- 連接埠：使用主機提供的 `PORT`
- 管理 PIN：設定環境變數 `ADMIN_PIN`
- 財務報表管理者密碼：設定環境變數 `FINANCE_ADMIN_PASSWORD`
- 候位資料檔：建議設定環境變數 `DATA_FILE`

範例：

```text
ADMIN_PIN=請改成你的管理密碼
FINANCE_ADMIN_PASSWORD=請改成你的財務管理者密碼
DATA_FILE=/data/queue.json
```

## 主機需求

請選「可以保存檔案」的主機，或加購/啟用 persistent disk。候位資料會存在 `DATA_FILE` 指定的位置。

如果主機沒有保存檔案的空間，網站仍可使用，但主機重啟或重新部署後候位資料可能會消失。

## 外部網址

部署完成後會得到一個 HTTPS 網址：

- 客人取號頁：`https://你的網址/`
- 店員管理頁：`https://你的網址/admin`
- 財務登入頁：`https://你的網址/finance-login`
- 日報表：`https://你的網址/finance`
- 月報表：`https://你的網址/monthly-report`
- 帳號管理：`https://你的網址/finance-users`

可以把客人取號頁做成 QR code 貼在店門口。
