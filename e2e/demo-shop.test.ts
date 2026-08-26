import assert from "node:assert/strict";
import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { chromium, type Browser } from "playwright";

const root = fileURLToPath(new URL("../demo-shop/", import.meta.url));
let server: Server;
let browser: Browser;
let baseUrl: string;

before(async () => {
  server = createStaticServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("DemoShop server did not expose a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("SAVE20 applies a 20 percent discount and reaches success", async () => {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.getByTestId("coupon-input").fill("SAVE20");
  await page.getByTestId("apply-coupon").click();

  assert.equal(await page.getByTestId("coupon-message").textContent(), "Discount applied");
  assert.equal(await page.getByTestId("order-total").textContent(), "80.00");

  await page.getByTestId("checkout").click();
  assert.match(page.url(), /#\/order\/success$/u);
  assert.equal(await page.getByTestId("success-total").textContent(), "80.00");
  await page.close();
});

test("EXPIRED20 is rejected and does not change the total", async () => {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.getByTestId("coupon-input").fill("EXPIRED20");
  await page.getByTestId("apply-coupon").click();

  assert.equal(await page.getByTestId("coupon-message").textContent(), "Coupon expired");
  assert.equal(await page.getByTestId("order-total").textContent(), "100.00");
  await page.close();
});

function createStaticServer(): Server {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const stat = statSync(file);
      if (!stat.isFile()) {
        throw new Error("Not a file");
      }
      response.writeHead(200, { "content-type": contentType(extname(file)) });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
}

function contentType(extension: string): string {
  switch (extension) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    default: return "application/octet-stream";
  }
}
