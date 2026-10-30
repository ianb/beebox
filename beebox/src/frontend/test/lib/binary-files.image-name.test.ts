// # Which file names are images
//
// `isImageFileName` takes a stored file name, so `?` and `#` are ordinary
// characters in it. History, Browse and chat image paths all share it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isImageFileName } from "../../src/lib/binary-files.js";
import { isImagePath } from "../../src/components/chat/message-parsing.js";

void test("every image extension is recognised, in any case", async (t) => {
  t.check(
    ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.avif", "a.bmp", "a.svg", "a.ico", "A.PNG"].map(isImageFileName),
    [true, true, true, true, true, true, true, true, true, true],
  );
});

void test("non-images and extensionless names are not images", async (t) => {
  t.check(["a.txt", "png", ".png", "README", "a.attach/README", "a.png.txt"].map(isImageFileName), [false, false, false, false, false, false]);
});

void test("# and ? are literal filename characters", async (t) => {
  t.check(["photo#1.png", "what?.png", "photo.png?v=1"].map(isImageFileName), [true, true, false]);
});

void test("an image path in chat strips its URL query and hash first", async (t) => {
  t.check(["photo.png?v=1", "photo.png#top", "a.attach/README"].map(isImagePath), [true, true, false]);
});
