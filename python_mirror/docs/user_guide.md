# MIRROR User Guide

1.2 Fetching of Python Libraries
Ensure that python_3.13.11 is installed via Company Portal
Open the following site: CPFB-DSA-MST - Documents - Python Libraries - All Documents
Sync it to your COMET machine as seen below:

This will create a folder in your own computer,
e.g. C:\Users\<soeid>\SG Govt M365\CPFB-DSA-MST - Python Libraries.
Ensure that the folder is synced before proceeding.
In your Command Prompt, run the following:
pip install "C:\Users\<soe-id>\SG Govt M365\CPFB-DSA-MST - Python Libraries\certifi-2026.2.25-py3-none-any.whl"

You can ignore any Warning messages shown in the Command Prompt.
1.3 Installation of App and Python Libraries
Download and unzip the MIRROR app folder into preferred location (e.g. Desktop)
Open Command Prompt
Navigate to python_mirror inside the MIRROR app folder (e.g. cd Desktop\MIRROR\python_mirror)
Tips to navigate:
Locate python_mirror in your File Explorer, and copy the directory path. You can do so by selecting/clicking on python_mirror, and either
Right click on the file > Copy as path; or
Press Ctrl+Shift+C
to get the directory path.

For example, if the path copied was "C:\Users\CPFXXXXX\OneDrive - SG Govt M365\Desktop\MIRROR\python_mirror",
then enter Command Prompt:
cd "C:\Users\CPFXXXX\OneDrive - SG Govt M365\Desktop\MIRROR\python_mirror"

Run the following:
pip install --upgrade --no-index --find-links="C:\Users\<soeid>\SG Govt M365\CPFB-DSA-MST - Python Libraries" --target "C:\ProgramData\PythonLib" -r requirements.txt
You can ignore any Warning messages shown in the Command Prompt.
Refer to Section 1.5.1 if issues are faced when installing.
Run the app with the following: python run_app.py
Then open your browser and go to http://127.0.0.1:5000 as shown below:

Log in using your username and password. You will be presented with your own dashboard page.

1.4 Future Launching of App
Sections 1.1 to 1.3 are only a one-time set up for the initial set up of MIRROR. Once the above steps are successfully done, they do not need to be re-done again. However, for section 1.1, do ensure that the shared OneDrive folder and the files are present and have not moved, else the app will not be able to start.
To open the app, follow these steps:
Navigate to python_mirror (e.g. cd Desktop\MIRROR\python_mirror)
Run the following: python run_app.py
1.5 Common Issues & Solutions During Installation
1.5.1 Issues regarding Python Libraries
It is likely that issues will be faced when installing the Python libraries, as certain libraries may already exist in COMET.
The libraries required are:
flask
pandas (ignore for COMET)
requests
watchdog
python-dotenv
openpyxl
Werkzeug
openai

If issues are faced when using the following command: pip install --upgrade --no-index --find-links="C:\Users\<soeid>\SG Govt M365\CPFB-DSA-MST - Python Libraries" --target "C:\ProgramData\PythonLib" -r requirements.txt
Then check if each library is already pre-existent in your machine, else install the library individually as shown below:
For each of the libraries listed above,
Into Command Prompt, enter: pip show <library name> (e.g. pip show flask)
If the library is not installed, you will see: WARNING: Package(s) not found: <library name> (e.g. WARNING: Package(s) not found: flask)
If Step 2 applies (i.e. the library is not installed), the run the following to install the library:
pip install --upgrade --no-index --find-links="C:\Users\<soeid>\SG Govt M365\CPFB-DSA-MST - Python Libraries" --target "C:\ProgramData\PythonLib" <library name>
e.g. pip install --upgrade --no-index --find-links="C:\Users\<soeid>\SG Govt M365\CPFB-DSA-MST - Python Libraries" --target "C:\ProgramData\PythonLib" flask
If Step 2 does not apply (i.e. the library is installed), then repeat steps for the remaining libraries.
e.g. pip show faiss-cpu, then do
pip install --upgrade --no-index --find-links="C:\Users\<soeid>\SG Govt M365\CPFB-DSA-MST - Python Libraries" --target "C:\ProgramData\PythonLib" faiss-cpu
if the library is not found.
Note that pandas should be ignored for COMET if it is already pre-installed. Refer to Section 1.5.2 for more information.
1.5.2 Issues regarding Pandas
The requirements.txt contains the Python libraries required for AuditMate (Local) to run. However, note that pandas does not need to be installed manually , as it comes pre-installed in COMET.

## 1. What MIRROR Does

MIRROR is a local web app that helps officers view their readiness, competency progress, training records, project evidence, customer feedback trends, and appraisal support.

The app reads data from the shared OneDrive MIRROR folder. Users do not need to manually upload the daily CSV anymore.

## 2. Before Opening MIRROR

Before starting the app, make sure the shared OneDrive folder is synced on the laptop.

Required folder:

```text
SG Govt M365\CPFB-CCC-MST-Correspondence Unit - Documents\CCU SUP\MIRROR
```

Required files in the folder:

```text
master_output.xlsx
ESS Verification Report_CCC.xlsx
TSS Verification Report_CCC.xlsx
CCU Final replies - [month/date].xlsx
CCU PQ [month/year].xlsx
training_data.xlsx
```

The file names for `CCU Final replies` and `CCU PQ` may change slightly by month, but they must still start with those names.

[Insert image: OneDrive MIRROR folder showing the required files]

## 3. Starting MIRROR

1. Open PowerShell.
2. Go to the MIRROR app folder.
3. Run:

```powershell
python run_app.py
```

When MIRROR starts, it automatically reads the files from the OneDrive folder and imports the latest data into the local database.

If a required file is missing, the app will stop and show an error telling you which file is missing.

[Insert image: PowerShell showing MIRROR running successfully]

## 4. Logging In

Open the local MIRROR URL in the browser, usually:

```text
http://127.0.0.1:5000
```

Login using your username and password.

For new users created by admin, the username is usually the officer ID, for example:

```text
cse001
tl001
csm001
ah001
```

[Insert image: MIRROR login page]

## 5. Dashboard

The Dashboard gives a quick overview of the officer's current readiness.

It shows:

- Current role
- Target role
- Readiness road progress
- Traffic light readiness status
- AI feedback summary
- Competency radar
- Flags and alerts
- Recent trend

The readiness road shows progress towards the target role. The traffic light gives a simple visual status.

[Insert image: Dashboard full page]

[Insert image: Readiness road and traffic light]

## 6. My Readiness

The My Readiness page explains what the officer needs to reach the next readiness stage.

It shows the main competency groups:

```text
Core competency
Functional competency
Correspondence competency
Leadership competency, for AH only
```

Each competency can be opened to see supporting details and development advice.

[Insert image: My Readiness page]

[Insert image: Expanded competency card]

If readiness is paused, a red pause alert will appear. This can happen when customer rating is low or a competency remains stagnant below the required level.

[Insert image: Readiness pause alert]

## 7. Competency Breakdown

Competency scores are calculated from imported evidence.

For most roles, competency evidence can include:

```text
Audit
Scorecard
Interactions
Projects
```

For AH, competencies are mainly project-based. `Team Development` is based on the average readiness of team members.

[Insert image: Competency breakdown section]

## 8. Training

The Training page shows completed training records.

Recommended courses are no longer shown directly. Instead, MIRROR can generate training keywords based on competency gaps. Officers can use these keywords to search for suitable courses themselves.

[Insert image: Training page]

[Insert image: Training keyword suggestions]

## 9. Projects

The Projects tab lets officers record project work.

Officers create a project and fill in:

- Project name
- Project manager
- Their role in the project
- Requirements
- Guided project questions

The project manager can later add evidence and comments. MIRROR uses project evidence to support competency scoring and appraisal drafting.

[Insert image: Projects page add project form]

[Insert image: Project record card]

## 10. Team Overview

Team leaders, CSMs, and AH users can view team members under their reporting line.

The Team Overview page shows team readiness and competency information without needing to open every officer's individual page.

[Insert image: Team Overview page]

## 11. Appraisal

The Appraisal tab helps officers draft appraisal responses using MIRROR data, especially project evidence.

The officer chooses a timeframe, then MIRROR generates draft answers for:

- Achievements based on targets
- Work concerns or needs
- Strengths and development areas
- Career goals or aspirations
- Ways to improve
- How supervisor can support
- Other matters

The officer should review, edit, and verify the generated text before using it.

[Insert image: Appraisal tab]

[Insert image: Generated appraisal draft]

## 12. Admin: Org Chart

Admin users can manage officers and reporting structure.

Admin can:

- Add officers
- Edit roles
- Assign managers
- Update team names
- Update trained schemes
- Delete officers

For officer IDs, use a consistent format such as:

```text
cse001
tl001
csm001
ah001
```

For the highest boss, leave `manager_id` blank.

[Insert image: Admin org chart page]

## 13. Admin: Weights and Thresholds

Admin can configure readiness weights and thresholds.

Weights control how different competency groups contribute to readiness.

Thresholds control the minimum required score for each readiness stage.

[Insert image: Admin weights and thresholds page]

## 14. Admin: OneDrive Data Flow

MIRROR now gets operational data from the shared OneDrive folder instead of manual daily CSV upload.

Current source files:

```text
Audit: master_output.xlsx
ESS: ESS Verification Report_CCC.xlsx
TSS: TSS Verification Report_CCC.xlsx
Interactions: CCU Final replies - [month/date].xlsx
Scorecard: CCU PQ [month/year].xlsx
Training: training_data.xlsx
```

When the app opens, it reads these files and updates the local MIRROR database.

[Insert image: OneDrive files and MIRROR dashboard side by side]

## 15. If Something Goes Wrong

If MIRROR does not start, check:

- Is the OneDrive MIRROR folder synced?
- Are all required files present?
- Are file names correct?
- Is the Excel file closed or accessible?
- Does the file contain `officer_id`?
- Does the officer already exist in MIRROR?

If the error says a file is missing, sync OneDrive or place the required file into the MIRROR folder.

## 16. Important Notes

MIRROR is local to the laptop. The OneDrive folder provides shared source files, but each laptop still has its own local database.

AI-generated text should be reviewed by the officer or supervisor before use.

Passwords should not be stored in shared Excel files. New officers should be given temporary passwords through the MIRROR admin process, then change their password after logging in.
