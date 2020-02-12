const fs = require('fs');
const readline = require('readline');
const puppeteer = require('puppeteer');
const commandLineArgs = require('command-line-args');

const COOKIE_PATH = './cookies.json';
var SPEC_TEST = false

Reset = "\x1b[0m"
FgRed = "\x1b[31m"
FgGreen = "\x1b[32m"
FgYellow = "\x1b[33m"
FgBlue = "\x1b[34m"
FgMagenta = "\x1b[35m"
FgCyan = "\x1b[36m"
FgWhite = "\x1b[37m"

const visit = async function(page, url, waitForSelector) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector,
      { visible: true, timeout: 10000 });
  }
};

const saveCookies = async function(page) {
  const cookies = await page.cookies();
  return fs.promises.writeFile(COOKIE_PATH, JSON.stringify(cookies, null, 2));
};

const loadCookies = async function(page) {
  try {
    const cookiesString = await fs.promises.readFile(COOKIE_PATH);
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
  } catch (e) {
    if (e.code === 'ENOENT') {
      // cookies.json not present, just continue
    } else {
      console.error(e);
    }
  }
};

const signIn = async function(page) {
  await visit(page, 'https://weblab.tudelft.nl/samlsignin');
  console.log("Not logged in yet, please login to WebLab.");
  await page.waitForResponse('https://weblab.tudelft.nl/', { timeout: 0 });
  console.log("Logged in!");
  await page.waitFor(3000);
  await saveCookies(page);
};

const downloadContents = async function(page, index, filename) {
  const contents = await page.evaluate((index) => {
    return window.aceEditorInstances[index].session.getValue();
  }, index);
  await fs.promises.writeFile(filename, contents, 'utf8');
};

const uploadContents = async function(page, index, filename) {
  const contents = await fs.promises.readFile(filename, 'utf8');
  await page.evaluate((index, contents) => {
    window.aceEditorInstances[index].session.setValue(contents);
  }, index, contents);
  await page.waitFor(400);
};

const runTest = async function(page, spec) {
  const saveButton = await page.$('#visibleSave');
  await saveButton.click();
  await page.waitForSelector('.save-button.saved', { visible: true });
  await page.waitFor(2000);
  const selector = spec === true ? '#specTestBtn' : '#userTestBtn';
  const testButton = await page.$(selector);
  await testButton.click();
  const modeStr = SPEC_TEST === false ? 'Your Test' : 'Spec Test';
  console.log(`${FgYellow}Running ${modeStr}${Reset}`);
};

const switchMode = function() {
  SPEC_TEST = !SPEC_TEST;
  const modeStr = SPEC_TEST === false ? 'Your Test' : 'Spec Test';
  console.log(`${FgRed}Mode: ${modeStr}${Reset}`);
};

(async () => {
  const args = commandLineArgs([
    { name: 'url', type: String },
    { name: 'src', type: String },
    { name: 'test', type: String },
  ]);
  if (!args.url || !args.src || !args.test) {
    return console.log(`Usage: weblab-runner
      --url <weblab submission url>
      --src <path to src code>
      --test <path to test code>`);
  }

  const url = args.url.indexOf('#') !== -1 ?
    args.url.substring(0, args.url.indexOf('#')) : args.url;

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await loadCookies(page);

  await visit(page, url, '#maincontainer');
  const [hasSignInButton] = await page.$x("//a[contains(., 'Sign in')]");
  if (hasSignInButton) {
    await signIn(page);
    await visit(page, url, '#maincontainer');
  }

	// Log compiler output
  await page.exposeFunction('outputChanged', (text) => {
		console.log(`${FgBlue}${text}${Reset}`);
	});
  await page.waitFor(2000);
  await page.evaluate(() => {
    var el = document.querySelector('#compilerOutput');
    var obs = new MutationObserver(function(e) {
      const text = document.querySelector('#compilerOutputPre').innerHTML.trim();
      window.outputChanged(text);
    });
    obs.observe(el, { characterData: true, childList: true });
  });

  await downloadContents(page, 0, args.src);
  await downloadContents(page, 1, args.test);

  console.log(`Downloaded ${args.src}, watching changes...`);
  console.log(`Downloaded ${args.test}, watching changes...`);
  const modeStr = SPEC_TEST === false ? 'Your Test' : 'Spec Test';
  console.log(`${FgRed}Mode: ${modeStr} (toggle using 's')${Reset}`);

  fs.watchFile(args.src, async (stat) => {
    console.log(`${FgYellow}Changed: ${args.src}${Reset}`);
    await uploadContents(page, 0, args.src);
    await runTest(page, SPEC_TEST);
  });

  fs.watchFile(args.test, async (time) => {
    console.log(`${FgYellow}Changed: ${args.test}${Reset}`);
    await uploadContents(page, 1, args.test);
    await runTest(page, SPEC_TEST);
  });

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit();
    } else {
      if (str === 's') {
        switchMode();
      }
    }
  });

})().catch((e) => console.error(e));
