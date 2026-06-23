# MIRROR Python

Python rebuild of the MIRROR app using local SQLite. SharePoint is only used manually by humans for temporary file download/upload; the code does not call SharePoint.

## Local Folder Setup

Copy `.env.example` to `.env`, then fill these values:

```env
FLASK_SECRET_KEY=change-this
MIRROR_LOCAL_ROOT=C:/Users/cpfaceta/OneDrive - SG Govt M365/MIRROR
MIRROR_DB_PATH=C:/Users/cpfaceta/OneDrive - SG Govt M365/MIRROR/database/master.db
MIRROR_MASTER_DB_PATH=C:/Users/cpfaceta/OneDrive - SG Govt M365/MIRROR/database/master.db
MIRROR_INCOMING_DIR=C:/Users/cpfaceta/OneDrive - SG Govt M365/MIRROR/incoming
MIRROR_OUTGOING_CHANGES_DIR=C:/Users/cpfaceta/OneDrive - SG Govt M365/MIRROR/outgoing_changes
```

Each laptop runs its own local copy. On COMET, use the user's private OneDrive folder as the local working folder. Users manually download files from SharePoint into this local/private OneDrive folder when needed.

Create the folders from `.env`:

```powershell
python scripts\setup_local_folders.py
```

## Local Confidential Config

Copy the column-map example and fill the real values only on the work laptop:

```powershell
copy config\column_map.example.json config\column_map.local.json
```

Do not share or commit:

```text
config/column_map.local.json
.env
```

`column_map.local.json` stores confidential column names. `.env` stores local paths and approved AI credentials.

## Install

```powershell
cd python_mirror
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python scripts\seed.py
python run_app.py
```

Open `http://127.0.0.1:5000`.

## Commands

Run the app:

```powershell
python run_app.py
```

## Manual SharePoint Workflow

There is no Entra/Graph/API connection. Use manual SharePoint download/upload.

Admin uploads the full SQLite snapshot to SharePoint. Each user downloads it locally, then runs:

```powershell
python scripts\manual_import.py --source C:\Path\To\master_snapshot.db --username cso001
```

For a TL:

```powershell
python scripts\manual_import.py --source C:\Path\To\master_snapshot.db --username tl001
```

Optional date range:

```powershell
python scripts\manual_import.py --source C:\Path\To\master_snapshot.db --username cso001 --from-date 2026-04-01 --to-date 2026-05-25
```

The scrub script reads permissions from the organisation chart in the
downloaded database. A CSE keeps only their own data; a TL or Supervisor keeps
their own data and the officers below them.

For Excel/CSV exports:

```powershell
python scripts\scrub_excel.py --source full_export.xlsx --username cso001 --output clean_export.xlsx
```

When a user submits a change in MIRROR, the app writes a JSON file to:

```text
C:\GSIB\MIRROR\outgoing_changes
```

The user manually uploads that JSON file to the SharePoint `Change_Requests/<username>/` folder.

Admin downloads collected change files and applies them to the master database:

```powershell
python scripts\apply_change_files.py --changes-dir C:\GSIB\MIRROR\downloaded_change_requests --master-db C:\GSIB\MIRROR\master\master.db
```

Applied files move to `processed_changes`; failed files move to `failed_changes` with an error text file.

## Local Data Uploads

Inside the app, use `Local Import` to upload survey/audit/reply CSV/XLSX files from the local drive. The app updates the same SQLite database in place. For example, importing January data replaces the existing January rows for that officer and stores the new rows in the same `master.db`.

## Safety Rule

Users never edit the SQLite database file directly. They use the app/scripts, which update the local `master.db` in place.
