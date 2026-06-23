## make playwright open the page
from __future__ import annotations

import json
from pathlib import Path
import re
import time

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError             ## sync = synchronous

import csv
import copy

BROWSE_URL = "https://www.learn.gov.sg/Learning/Browse"
REQUEST_URL = "https://www.learn.gov.sg/Learning/screenservices/Learning/MainFlow/BrowseMainContent_V2/DataActionGetMyLearningList"        ## taken from Inspect > Network
DETAIL_PAGE_URL = "https://www.learn.gov.sg/Learning/BrowseDetails?ProgCode={prog_code}&LastEntry="         ## just take any course's details page and replace {prog_code} with their actual ProgCode
MAX_RECORDS = 12
ROOT = Path(__file__).resolve().parents[1]                  ## finds the python_mirror folder relative to this file, parents[0] = python_mirror/scripts
OUTPUT = ROOT / "config" / "course_catalogue.local.csv"     ## ROOT is the main app folder
FULL_SYNC_PAGES = 25
REFRESH_SYNC_PAGES = 1
FORCE_FULL_SYNC = True
FIELDNAMES = [ "title", "start_date", "price", "product_type", "duration", "course_url", "provider", "description", "learning_outcomes", "who_should_attend",]


## HELPER: turn lines in card into dict
def parse_card_text(text: str) -> dict[str, str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    if lines and lines[0].lower() == "new":
        lines = lines[1:]

    title = lines[0] if lines else ""
    start_date = ""
    price = ""
    product_type = ""
    duration = ""

    for line in lines[1:]:
        if line.startswith("Starting on"):
            start_date = line.replace("Starting on", "").strip()
        elif line.startswith("$"):
            price = line
        elif "•" in line:
            parts = [part.strip() for part in line.split("•")]
            product_type = parts[0] if len(parts) > 0 else ""
            duration = parts[1] if len(parts) > 1 else ""

    return {
        "title": title,
        "start_date": start_date,
        "price": price,
        "product_type": product_type,
        "duration": duration,
    }


## HELPER: use course_url as the unique key. If no URL yet, use title.
def course_key(course: dict[str, str]) -> str:
    return course.get("course_url") or course.get("title", "")


## HELPER: API gives duration in minutes, but MIRROR displays hours
def format_duration(minutes: str) -> str:
    if not str(minutes).strip().isdigit():
        return str(minutes or "")

    total_minutes = int(minutes)
    hours = total_minutes / 60

    if hours.is_integer():
        return f"{int(hours)}h"

    return f"{hours:.1f}h"


## HELPER: read the existing full catalogue before a quick refresh
def load_existing_courses() -> list[dict[str, str]]:
    if not OUTPUT.exists():
        return []

    with OUTPUT.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


## HELPER: keep old courses, but replace them with newly scraped versions if matched
def merge_courses(existing_courses: list[dict[str, str]], scraped_courses: list[dict[str, str]]) -> list[dict[str, str]]:
    merged = {}

    for course in existing_courses:
        key = course_key(course)
        if key:
            merged[key] = course

    for course in scraped_courses:
        key = course_key(course)
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


## HELPER: wait until the visible course cards have real text, not empty loading containers + return all the cards text if assigned to variable
def card_texts(page, expected_count: int = 1) -> list[str]:
    deadline = time.time() + 30
    while time.time() < deadline:
        cards = page.locator(".programmecard-maincontainer:visible")
        texts = [cards.nth(index).inner_text().strip() for index in range(cards.count())]
        real_texts = [text for text in texts if parse_card_text(text)["title"]]
        if len(real_texts) >= expected_count:
            return texts
        page.wait_for_timeout(500)
    return [text.strip() for text in texts]


## HELPER: click into the course's details page, get info, then go back to main menu
def read_detail_page(page, index: int) -> dict[str, str]:               ## page.locator: Playwright pls find the title area inside the fresh card, then click on it
    cards = page.locator(".programmecard-maincontainer:visible")
    card = cards.nth(index)
    ##title_area = card.locator(".margin-bottom-xs").first
    try:
        card.click(timeout=10000)
        page.wait_for_url("**/Learning/BrowseDetails**", timeout=20000)         ## confirms the course detail page actually opened.
    except PlaywrightTimeoutError:
        print("Could not open detail page")
        return {
            "course_url": "",
            "provider": "",
            "description": "",
            "learning_outcomes": "",
            "who_should_attend": "",
        }

    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)

    course_url = page.url                           ## CURRENT url, do not move to return, the page will already have gone back to main menu
    body_text = ""

    ## gives the page up to 10sec to populate the text
    for _ in range(20):
        body_text = page.locator("body").inner_text()

        if "Overview" in body_text and "Learning Outcomes" in body_text:
            break

        page.wait_for_timeout(500)

    provider = ""
    if "Provided By" in body_text:
        provider = body_text.split("Provided By", 1)[1].splitlines()[1].strip()         ## find the text after Provided By, then take the 2nd line of that

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

    page.go_back(wait_until="networkidle")          ## just the back button
    page.locator(".programmecard-maincontainer:visible").first.wait_for(timeout=30000)
    card_texts(page)
    page.wait_for_timeout(1000)

    return {
        "course_url": course_url,
        "provider": provider,
        "description": overview[:1000],
        "learning_outcomes": learning_outcomes[:1000],
        "who_should_attend": who_should_attend[:1000],
    }

## HELPER: get the result range text, eg. "1 to 12 of 293 items = page 1" (this is at the bottom of each page in the site)
def current_results_range(page) -> str:
    body_text = page.locator("body").inner_text()

    for line in body_text.splitlines():
        if " of " in line and " items" in line:
            return line.strip()

    return ""


## HELPER: for pagination (all 25 pages!): clicks the next button + make sure page changed
def go_to_next_results_page(page) -> None:
    old_range = current_results_range(page)

    page.keyboard.press("End")
    next_button = page.locator('button[aria-label="go to next page"]:visible')
    try:
        next_button.click(timeout=10000)           ## inspecting the next button, its label is "go to next page"
    except PlaywrightTimeoutError:
        next_button.evaluate("button => button.click()")

    deadline = time.time() + 30
    while time.time() < deadline:
        new_range = current_results_range(page)         ## that means page changed

        if new_range and new_range != old_range:
            card_texts(page)                            ## just to make sure page loaded fully
            return

        page.wait_for_timeout(500)

    print("Warning: page did not appear to change")


## HELPER: reset to Browse page, then move forward until the requested page
def open_browse_page(page) -> None:
    for attempt in range(2):
        try:
            page.goto(BROWSE_URL, wait_until="domcontentloaded", timeout=60000)          ## go page 1
            card_texts(page)                                                            ## wait for JS course cards ourselves
            return
        except PlaywrightTimeoutError:
            print("Browse page load timed out, retrying...")
            if attempt == 1:
                raise


## HELPER: reset to Browse page, then move forward until the requested page
def go_to_results_page(page, page_number: int) -> None:
    open_browse_page(page)
    card_texts(page)                                                        ## just to make sure page 1 loaded fully, so that next button is there

    for _ in range(page_number - 1):                                        ## page 10 = click next 9 times
        go_to_next_results_page(page)


## HELPER: check whether browser is already showing the page we want
def is_on_results_page(page, page_number: int) -> bool:
    expected_start = ((page_number - 1) * 12) + 1
    return current_results_range(page).startswith(f"{expected_start} ")


## HELPER: only navigate if the browser is not already on the right results page
def ensure_results_page(page, page_number: int) -> None:
    if not is_on_results_page(page, page_number):
        go_to_results_page(page, page_number)


## HELPER: capture original API request payload to be edited later
def capture_learning_list_payload(page) -> dict:
    captured = {}           ## just to store { "payload": {...} }

    def handle_request(request):
        if "DataActionGetMyLearningList" in request.url:
            captured["payload"] = request.post_data_json            ## steal/copy its payload as a Python dict

    page.on("request", handle_request)          ## watch the browser's Network requests (specifically look out for DataActionGetMyLearningList requests)
    open_browse_page(page)                      ## this is after page.on because the website instantly sends the DataAction.. request

    deadline = time.time() + 30
    while time.time() < deadline:
        if "payload" in captured:
            return captured["payload"]              ## return the stolen payload so we can use it

        page.wait_for_timeout(500)

    raise RuntimeError("Could not capture DataActionGetMyLearningList payload")


## HELPER: turn the real DataActionGetMyLearningList response into course dictionaries
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


## HELPER: listen for the website's own API response while opening Browse page
def load_first_course_page(page) -> list[dict[str, str]]:
    with page.expect_response(lambda response: "DataActionGetMyLearningList" in response.url) as response_info:
        open_browse_page(page)

    data = response_info.value.json()
    return courses_from_learning_list_response(data)


## HELPER: listen for the website's own API response after clicking next
def load_next_course_page(page) -> list[dict[str, str]]:
    with page.expect_response(lambda response: "DataActionGetMyLearningList" in response.url) as response_info:
        go_to_next_results_page(page)

    data = response_info.value.json()
    return courses_from_learning_list_response(data)


## HELPER: clean text from API values
def clean_detail_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


## HELPER: find useful text fields in unknown nested JSON from the detail page
def find_text_by_key(data, key_words: tuple[str, ...]) -> str:
    found = []

    def walk(value, parent_key: str = "") -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, str(key))
        elif isinstance(value, list):
            for child in value:
                walk(child, parent_key)
        elif isinstance(value, str):
            key = parent_key.lower().replace("_", "")
            if any(word in key for word in key_words):
                text = clean_detail_text(value)
                if text:
                    found.append(text)

    walk(data)
    return "\n".join(dict.fromkeys(found))


## HELPER: find a price/fee inside unknown nested JSON from the detail page
def find_price_in_json(data) -> str:
    prices = []

    def walk(value, parent_key: str = "") -> None:
        key = parent_key.lower()
        if isinstance(value, dict):
            for child_key, child in value.items():
                walk(child, str(child_key))
        elif isinstance(value, list):
            for child in value:
                walk(child, parent_key)
        elif isinstance(value, str):
            match = re.search(r"\$[\d,]+(?:\.\d{2})?", value)
            if match:
                prices.append(match.group(0))
        elif isinstance(value, int | float):
            if any(word in key for word in ("price", "fee", "cost", "amount")) and value > 0:
                prices.append(f"${value:,.2f}")

    walk(data)
    return prices[0] if prices else ""


## HELPER: edit payload request to read detail URL directly, replaces clicking card index
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

    detail_api_responses = []

    def handle_detail_response(response):
        if "screenservices" not in response.url.lower():
            return

        try:
            detail_api_responses.append(response.json())
        except Exception:
            pass

    page.on("response", handle_detail_response)
    page.goto(course_url, wait_until="domcontentloaded", timeout=60000)

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
    page.remove_listener("response", handle_detail_response)

    if course["title"] not in body_text:
        print("Detail page did not finish loading for:")
        print(course)

    date_matches = re.findall(r"\b\d{2} [A-Za-z]{3} \d{4}\b", body_text)
    start_date = date_matches[0] if date_matches else ""

    price_match = re.search(r"\$[\d,]+(?:\.\d{2})?", body_text)
    price = price_match.group(0) if price_match else ""

    def section_between(start: str, end_markers: tuple[str, ...]) -> str:
        if start not in body_text:
            return ""

        section = body_text.split(start, 1)[1]
        for marker in end_markers:
            if marker in section:
                section = section.split(marker, 1)[0]
                break

        return section.strip()

    overview = ""
    if "Overview" in body_text:
        overview = section_between("Overview", ("Learning Outcomes", "Remarks", "Who Should Attend", "Programme Details", "Show Sessions", "Apply Now"))
    elif "About Programme" in body_text:
        overview = section_between("About Programme", ("Learning Outcomes", "Remarks", "Who Should Attend", "Programme Details", "Show Sessions", "Apply Now"))

    learning_outcomes = ""
    if "Learning Outcomes" in body_text:
        learning_outcomes = section_between("Learning Outcomes", ("Remarks", "Who Should Attend", "Programme Details", "Show Sessions", "Apply Now"))

    who_should_attend = ""
    if "Who Should Attend" in body_text:
        who_should_attend = section_between("Who Should Attend", ("Outline", "Programme Details", "Show Sessions", "Apply Now"))

    for detail_data in detail_api_responses:
        if not price:
            price = find_price_in_json(detail_data)

        if not overview:
            overview = find_text_by_key(detail_data, ("overview", "description", "aboutprogramme", "summary", "remarks", "objective", "synopsis", "content"))

        if not learning_outcomes:
            learning_outcomes = find_text_by_key(detail_data, ("learningoutcome", "learningobjective", "outcome", "objective"))

        if not who_should_attend:
            who_should_attend = find_text_by_key(detail_data, ("whoshouldattend", "targetaudience", "targetprofile", "audience"))

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

            ## extract all 12 course cards from 1 page, cards = [card0, card1, card2, ..., card11]
            ## texts = card_texts(page)
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

