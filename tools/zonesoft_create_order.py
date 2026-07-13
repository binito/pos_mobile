#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


DEFAULT_CLIENT_TERMS = ["2"]


def chrome_options():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-setuid-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--remote-debugging-port=0")
    options.add_argument("--disable-gpu")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.binary_location = os.getenv("CHROMIUM_BIN", "/usr/bin/chromium-browser")
    return options


def click(driver, x, y):
    ActionChains(driver).move_by_offset(x, y).click().perform()
    ActionChains(driver).move_by_offset(-x, -y).perform()


def type_text(driver, text):
    ActionChains(driver).send_keys(str(text)).perform()


def body_text(driver):
    return driver.find_element(By.TAG_NAME, "body").text


def login(driver):
    wait = WebDriverWait(driver, 60)
    driver.get("https://zsbmsv2.zonesoft.org/#!/login")
    time.sleep(15)
    wait.until(EC.presence_of_all_elements_located((By.TAG_NAME, "input")))

    try:
        driver.execute_script(
            "arguments[0].click();",
            driver.find_element(By.XPATH, "//button[contains(text(), 'Ok! Compreendi')]")
        )
        time.sleep(1)
    except Exception:
        pass

    for element_id, env_name in [
        ("inputNIF", "ZONESOFT_NIF"),
        ("inputUser", "ZONESOFT_LOGIN"),
        ("inputPassword", "ZONESOFT_PASSWORD"),
    ]:
        value = os.getenv(env_name)
        if not value:
            raise RuntimeError(f"Missing {env_name}")
        field = wait.until(EC.element_to_be_clickable((By.ID, element_id)))
        field.clear()
        field.send_keys(value)

    driver.execute_script(
        "arguments[0].click();",
        wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Entrar')]")))
    )
    time.sleep(15)


def open_new_order(driver):
    wait = WebDriverWait(driver, 60)
    driver.get("https://zsbmsv2.zonesoft.org/#!/docs-clientes-encomendas")
    time.sleep(12)
    driver.execute_script(
        "arguments[0].click();",
        wait.until(EC.element_to_be_clickable((By.ID, "btnAdicionar")))
    )
    time.sleep(12)


def select_store_cafe(driver):
    click(driver, 596, 135)
    time.sleep(1)
    click(driver, 450, 232)
    time.sleep(3)
    if "Loja\nCafé" not in body_text(driver) and "Loja\n1 - Café" not in body_text(driver):
        raise RuntimeError("Nao consegui selecionar a loja Cafe.")


def select_client(driver, terms):
    last_body = ""
    for term in terms:
        click(driver, 450, 211)
        time.sleep(0.5)
        ActionChains(driver).send_keys(Keys.CONTROL, "a").send_keys(Keys.BACKSPACE).perform()
        type_text(driver, term)
        time.sleep(4)
        last_body = body_text(driver)
        if "Sem resultados" not in last_body:
            ActionChains(driver).send_keys(Keys.ARROW_DOWN).send_keys(Keys.ENTER).perform()
            time.sleep(4)
            if "Desconto fixo" in body_text(driver) or "Contacto" in body_text(driver):
                return
    raise RuntimeError(f"Nao consegui selecionar cliente. Ultimo resultado: {last_body[:300]}")


def add_product_line(driver, item):
    code = str(item.get("code") or "").strip()
    if not code or code == "MANUAL":
        raise RuntimeError(f"Produto sem codigo ZoneSoft: {item.get('name')}")

    click(driver, 350, 484)
    time.sleep(0.5)
    ActionChains(driver).send_keys(Keys.CONTROL, "a").send_keys(Keys.BACKSPACE).perform()
    type_text(driver, code)
    time.sleep(4)
    ActionChains(driver).send_keys(Keys.ARROW_DOWN).send_keys(Keys.ENTER).perform()
    time.sleep(3)

    body = body_text(driver)
    if code not in body:
        raise RuntimeError(f"Nao consegui selecionar produto {code} ({item.get('name')}).")

    qty = int(round(float(item.get("qty") or 1)))
    qty_input = WebDriverWait(driver, 20).until(EC.element_to_be_clickable((By.ID, "inputQtd")))
    qty_input.click()
    qty_input.send_keys(Keys.CONTROL, "a")
    qty_input.send_keys(str(qty))
    time.sleep(1)

    click(driver, 1785, 558)
    time.sleep(3)

    body = body_text(driver)
    if code not in body or str(qty) not in body:
        raise RuntimeError(f"A linha do produto {code} nao ficou confirmada.")


def add_observation(driver, order):
    note = f"Pedido app {order.get('id', '')}".strip()
    customer = order.get("customer", {}).get("name")
    if customer:
        note += f" - {customer}"
    try:
        textarea = driver.find_element(By.CSS_SELECTOR, "textarea[ng-model='vm.instance.descricao']")
        textarea.click()
        textarea.send_keys(note[:250])
    except Exception:
        pass


def save_order(driver):
    body = body_text(driver)
    if "Total Encomenda\n0,00" in body:
        raise RuntimeError("Total da encomenda ficou a zero; nao gravei.")

    save_button = WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Guardar Documento') and contains(@ng-click, 'saveDocument')]"))
    )
    driver.execute_script("arguments[0].click();", save_button)
    time.sleep(10)

    body = body_text(driver)
    match = re.search(r"\bEC\s+[A-Z0-9]+/\d+\b", body)
    if not match:
        raise RuntimeError(f"Encomenda gravada sem numero visivel? Ecrã: {body[:800]}")
    return match.group(0)


def create_zonesoft_order(order, client_terms, dry_run=False):
    driver = webdriver.Chrome(service=Service(os.getenv("CHROMEDRIVER", "/usr/bin/chromedriver")), options=chrome_options())
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "Object.defineProperty(navigator, 'webdriver', { get: () => undefined })"
    })

    try:
        login(driver)
        open_new_order(driver)
        select_store_cafe(driver)
        select_client(driver, client_terms)
        add_observation(driver, order)

        for item in order.get("items") or []:
            add_product_line(driver, item)

        if dry_run:
            return {"ok": True, "dryRun": True}

        document = save_order(driver)
        return {"ok": True, "document": document}
    finally:
        driver.quit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("order_json")
    parser.add_argument("--client", action="append", dest="clients")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    order = json.loads(Path(args.order_json).read_text(encoding="utf-8"))
    client_terms = args.clients or [
        value.strip()
        for value in os.getenv("ZONESOFT_ORDER_CLIENT_SEARCH", "").split(",")
        if value.strip()
    ] or DEFAULT_CLIENT_TERMS

    result = create_zonesoft_order(order, client_terms, args.dry_run)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
