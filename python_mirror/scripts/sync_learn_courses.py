## make playwright open the page
from __future__ import annotations

from pathlib import Path
import re
import time

from playwright.sync_api import sync_playwright             ## sync = synchronous

import csv

BROWSE_URL = "https://www.learn.gov.sg/Learning/Browse"
DETAIL_PAGE_URL = "https://www.learn.gov.sg/Learning/BrowseDetails?ProgCode={prog_code}&LastEntry="         ## just take any course's details page and replace {prog_code} with their actual ProgCode
ROOT = Path(__file__).resolve().parents[1]                  ## finds the python_mirror folder relative to this file, parents[0] = python_mirror/scripts
OUTPUT = ROOT / "config" / "course_catalogue.local.csv"     ## ROOT is the main app folder
FULL_SYNC_PAGES = 25
REFRESH_SYNC_PAGES = 3
FORCE_FULL_SYNC = False
FIELDNAMES = [ "title", "start_date", "price", "product_type", "duration", "course_url", "provider", "description", "learning_outcomes", "who_should_attend",]


## HELPER: read the existing full catalogue before a quick refresh
def load_existing_courses() -> list[dict[str, str]]:
    if not OUTPUT.exists():
        return []

    with OUTPUT.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


## HELPER: keep old courses, but replace them with newly scraped versions if matched, pri key is course_url or title
def merge_courses(existing_courses: list[dict[str, str]], scraped_courses: list[dict[str, str]]) -> list[dict[str, str]]:
    merged = {}

    for course in existing_courses:
        key = course.get("course_url") or course.get("title", "")
        if key:
            merged[key] = course

    for course in scraped_courses:
        key = course.get("course_url") or course.get("title", "")
        if key:
            merged[key] = course

    return list(merged.values())


## HELPER: save progress immediately, so a crash does not lose all scraped pages
def save_courses(courses: list[dict[str, str]]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)        ## just making sure config folder exists (parent)

    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:         ## open csv for writing, handle = the name of this opened file
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)              ## writer is a csv.DictWriter object. It is a helper object that knows how to turn Python dictionaries into CSV rows.
        writer.writeheader()                                                ## writes the fieldnames (1st row)
        writer.writerows(courses)                                           ## writes the rest of the rows (the actual data)



## HELPER: API gives duration in minutes, but MIRROR displays hours
def format_duration(minutes: str) -> str:
    if not str(minutes).strip().isdigit():
        return str(minutes or "")

    total_minutes = int(minutes)
    hours = total_minutes / 60

    if hours.is_integer():
        return f"{int(hours)}h"

    return f"{hours:.1f}h"


## HELPER: turn the real DataActionGetMyLearningList response of this page into a list of python dicts, 1 course 1 dict
def courses_from_learning_list_response(data: dict) -> list[dict[str, str]]:
    items = data["data"]["ProgrammeList"]["List"]      ## all the course cards in this page, as seen from Inspect > Network > DataActionGetMyLearningList > Response

    courses = []

    for item in items:
        details = item.get("ProgrammeDetails", {})
        partners = item.get("Partners", {}).get("List", [])

        provider = ""
        if partners:
            provider = partners[0].get("Name", "")

        prog_code = details.get("ProgCode", "")
        course_url = DETAIL_PAGE_URL.format(prog_code=prog_code) if prog_code else ""

        courses.append({
            "title": details.get("Title", ""),
            "start_date": "",
            "price": "",
            "product_type": details.get("ProductTypeLabel", ""),
            "duration": format_duration(details.get("Duration", "")),
            "course_url": course_url,
            "provider": provider,
            "description": "",
            "learning_outcomes": "",
            "who_should_attend": "",
        })

    return courses


## HELPER: listen for the website's own API response while opening Browse page (page 1)
def load_first_course_page(page) -> list[dict[str, str]]:
    with page.expect_response(lambda response: "DataActionGetMyLearningList" in response.url) as response_info:
        page.goto(BROWSE_URL, wait_until="domcontentloaded", timeout=60000)             ## open Browse page so the site sends its real course-list API request
        ## start listening, open browse page, let the website's own JS call DataActionGetMyLearningList, capture the response

    data = response_info.value.json()
    return courses_from_learning_list_response(data)


## HELPER: listen for the website's own API response after clicking next with the correct start_index (page 2)
def load_next_course_page(page) -> list[dict[str, str]]:
    with page.expect_response(lambda response: "DataActionGetMyLearningList" in response.url) as response_info:
        page.keyboard.press("End")
        page.locator('button[aria-label="go to next page"]:visible').click(timeout=10000, force=True)       ## click next so the site sends the next course-list API request

    data = response_info.value.json()
    return courses_from_learning_list_response(data)



## HELPER: go into detail URL directly using the course's info from the card (including the url)
def read_detail_url(page, course: dict[str, str]) -> dict[str, str]:
    course_url = course["course_url"]
    if not course_url:
        return {
            "start_date": "",
            "price": "",
            "description": "",
            "learning_outcomes": "",
            "who_should_attend": "",
        }

    page.goto(course_url, wait_until="domcontentloaded", timeout=60000)


    ## all this just to make site load finish first then get info
    body_text = ""
    deadline = time.time() + 30
    while time.time() < deadline:
        body_text = page.locator("body").inner_text()

        detail_markers = ("About Programme", "Overview", "Learning Outcomes", "Programme Code:", "Apply Now")
        if course["title"] in body_text and any(marker in body_text for marker in detail_markers):
            break

        page.wait_for_timeout(500)

    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    body_text_parts = [page.locator("body").inner_text()]

    for _ in range(8):
        page.mouse.wheel(0, 900)
        page.wait_for_timeout(500)
        body_text_parts.append(page.locator("body").inner_text())

    body_text = "\n".join(dict.fromkeys(body_text_parts))


    ## scrape info
    start_date = ""
    if "Start Date" in body_text and "Venue" in body_text:
        start_date = body_text.split("Start Date", 1)[1].split("Venue", 1)[0].strip()

    price = ""
    if "/ participant" in body_text:
        before_participant = body_text.split("/ participant", 1)[0]
        price_matches = re.findall(r"\$[\d,]+(?:\.\d{2})?", before_participant)

        if price_matches:
            price = price_matches[-1]

    overview = ""
    if "Overview" in body_text:
        overview = body_text.split("Overview", 1)[1].split("Learning Outcomes", 1)[0].strip()

    learning_outcomes = ""
    if "Learning Outcomes" in body_text:
        after_learning_outcomes = body_text.split("Learning Outcomes", 1)[1]

        if "Remarks" in after_learning_outcomes:
            learning_outcomes = after_learning_outcomes.split("Remarks", 1)[0].strip()
        elif "Who Should Attend" in after_learning_outcomes:
            learning_outcomes = after_learning_outcomes.split("Who Should Attend", 1)[0].strip()
        else:
            learning_outcomes = after_learning_outcomes.strip()

    who_should_attend = ""
    if "Who Should Attend" in body_text:
        who_should_attend = body_text.split("Who Should Attend", 1)[1].split("Outline", 1)[0].strip()

    ## No need to return to browse page. Now we open detail URLs directly, and the next API call does not depend on what page the browser is visually showing.

    return {
        "start_date": start_date,
        "price": price,
        "description": overview[:1000],
        "learning_outcomes": learning_outcomes[:1000],
        "who_should_attend": who_should_attend[:1000],
    }




def main() -> None:
    existing_courses = load_existing_courses()
    is_full_sync = FORCE_FULL_SYNC or not existing_courses
    max_pages = FULL_SYNC_PAGES if is_full_sync else REFRESH_SYNC_PAGES

    print("Full course catalogue sync" if is_full_sync else "Course catalogue refresh")
    print(f"Pages to scrape: {max_pages}")

    playwright = sync_playwright().start()                              ## start playwright
    browser = playwright.chromium.launch(headless=True)                 ## opens Chromium, headless=False means show the browser window, True means dont
    try:
        page = browser.new_page()                                       ## opens new browser tab for Browse/API pagination
        detail_page = browser.new_page()                                ## opens another tab for course detail pages, so Browse page stays in place

        courses = []
        ## test
        ## print("Title:", page.title())                           ## title of browser tab
        ## print(page.locator("body").inner_text()[:2000])         ## locator("body"): find the body element on the page, inner_text(): get the visible text inside it, [:2000]: only print the first 2000 characters

        for page_number in range(1, max_pages + 1):
            print(f"Scraping page {page_number}")

            if page_number == 1:
                page_courses = load_first_course_page(page)
            else:
                page_courses = load_next_course_page(page)

            print("Cards found: ", len(page_courses))

            for course in page_courses:
                details = read_detail_url(detail_page, course)
                course.update(details)                      ## add course overview to the dict

                print("----")
                print(course)

                courses.append(course)
                save_courses(merge_courses(existing_courses, courses))

        courses = merge_courses(existing_courses, courses)
        save_courses(courses)

        print(f"Saved {len(courses)} courses to {OUTPUT}")
    finally:
        try:
            browser.close()
        finally:
            playwright.stop()

if __name__ == "__main__":
    main()

