const distFolder = process.env.DIST_FOLDER || "build";
const fs = require("fs");
const path = require("path");
const glob = require("glob");
const chokidar = require("chokidar");
const express = require("express");
const { execSync } = require("child_process");
const readline = require("readline");

// read bos.config.json from app folders
function readBosConfig(workspaceFolder) {
  const configPath = path.join("./workspaces", workspaceFolder, "bos.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`bos.config.json not found in ${workspaceFolder}`);
  }
  const configRaw = fs.readFileSync(configPath);
  try {
    JSON.parse(configRaw);
  } catch (e) {
    throw new Error(`${workspaceFolder}/bos.config.json is not a valid json file`);
  }
  const config = JSON.parse(configRaw);
  if (!config.creatorAccount) {
    console.warn(
      `WARNING: creatorAccount not found in ${workspaceFolder}/bos.config.json, build script may work but dev requires it`
    );
  }
  return config;
}

// process comment commands and replace content in files
function processCommentCommands(fileContent, aliases, creatorAccount) {
  // Process the aliases
  if (aliases) {
    for (let alias in aliases) {
      let replacePattern = new RegExp(`/\\*__@replace:${alias}__\\*/`, "g");
      fileContent = fileContent.replace(replacePattern, aliases[alias]);
    }
  }

  // Replace the creatorAccount
  if (creatorAccount) {
    let accountPattern = /\/\*__@creatorAccount__\*\//g;
    fileContent = fileContent.replace(accountPattern, creatorAccount);
  }

  return fileContent;
}

// import modules from /modules folder
function importModules(fileContent) {
  let importPattern = /\/\*__@import:(.+?)__\*\//g;
  let match;

  while ((match = importPattern.exec(fileContent)) !== null) {
    let modulePath = path.join("./modules", `${match[1]}.js`);
    let moduleContent = fs.readFileSync(modulePath, "utf8");
    fileContent = fileContent.replace(match[0], moduleContent);
  }

  return fileContent;
}

// skip files
function shouldSkipFile(fileContent) {
  let skipPattern = /\/\*__@skip__\*\//;
  return skipPattern.test(fileContent);
}

// process each file
function processFile(filePath, aliases, creatorAccount) {
  let fileContent = fs.readFileSync(filePath, "utf8");

  if (shouldSkipFile(fileContent)) return;

  fileContent = processCommentCommands(fileContent, aliases, creatorAccount);
  fileContent = importModules(fileContent);

  fs.writeFileSync(filePath, fileContent);
}

// walk through each app folder
function processDistFolder(workspaceFolder) {
  const files = glob.sync(
    `./${distFolder}/${workspaceFolder}/**/*.{js,jsx,ts,tsx,json}`
  );

  const config = readBosConfig(workspaceFolder);

  files.forEach((file) => processFile(file, config.aliases, config.creatorAccount));
}

// generate the dist folder structure
function generateDistFolder(workspaceFolder) {
  const distPath = path.join(`./${distFolder}`, workspaceFolder);
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true });
  }
  fs.mkdirSync(distPath, { recursive: true });

  const files = glob.sync(`./workspaces/${workspaceFolder}/widget/**/*.{js,jsx,ts,tsx}`);
  files.forEach((file) => {
    const distFilePath = file
      .replace(workspaceFolder + "/widget", workspaceFolder + "/src")
      .replace("./workspaces", `./${distFolder}`);
    if (!fs.existsSync(path.dirname(distFilePath))) {
      fs.mkdirSync(path.dirname(distFilePath), { recursive: true });
    }
    fs.copyFileSync(file, distFilePath);
  });
}

// ignore files
function ignoreFiles(fileContent) {
  let ignorePattern = /\/\*__@ignore__\*\//;
  return ignorePattern.test(fileContent);
}

// no stringify json files
// TODO: need tests
function noStringifyJsonFiles(fileContent) {
  let noStringifyPattern = /\/\*__@noStringify__\*\//;
  return noStringifyPattern.test(fileContent);
}

// TODO: need tests
function removeComments(fileContent) {
  return fileContent
    .replace(/\/\*[\s\S]*?\*\/|(?<=[^:])\/\/.*|^\/\/.*/g, "")
    .trim();
}

// generate data.json file
function generateDataJson(workspaceFolder) {
  const data = {};
  const files = glob.sync(`./workspaces/${workspaceFolder}/**/*.{jsonc,txt}`);
  const config = readBosConfig(workspaceFolder);

  files.forEach((file) => {
    let fileContent = fs.readFileSync(file, "utf8");
    if (ignoreFiles(fileContent)) return;
    if (file.endsWith(".jsonc")) {
      // If it's a JSONC file and has the noStringify marker, parse the content
      // Otherwise, just remove comments and spaces as before
      // first process comment commands
      fileContent = processCommentCommands(
        fileContent,
        config.aliases,
        config.creatorAccount
      );
      if (noStringifyJsonFiles(fileContent)) {
        fileContent = JSON.parse(removeComments(fileContent));
      } else {
        fileContent = removeComments(fileContent).replace(/\s/g, ""); // remove comments and spaces
      }
    }
    const keys = file.replace(`./workspaces/${workspaceFolder}/`, "").split("/");
    // remove file extension
    keys[keys.length - 1] = keys[keys.length - 1]
      .split(".")
      .slice(0, -1)
      .join(".");
    keys.reduce((obj, key, i) => {
      if (i === keys.length - 1) {
        if (typeof fileContent === "object") {
          obj[key] = { ...obj[key], ...fileContent }; // merge if object
        } else {
          obj[key] = fileContent;
        }
      } else {
        if (!obj[key]) obj[key] = {}; // if the key doesn't exist yet, create an object
      }
      return obj[key];
    }, data);
  });

  const dataPath = path.join(`./${distFolder}`, workspaceFolder, "data.json");

  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

// generate the development json from the workspaces widgets
function generateDevJson(workspaceFolder) {
  let devJson = { components: {}, data: {} };

  const appConfig = readBosConfig(workspaceFolder);
  if (!appConfig.creatorAccount) {
    return devJson;
  }
  const widgetFiles = glob.sync(
    `./${distFolder}/${workspaceFolder}/src/**/*.{js,jsx,ts,tsx}`
  );
  const dataJSON = JSON.parse(
    fs.readFileSync(`./${distFolder}/${workspaceFolder}/data.json`, "utf8")
  );
  devJson.data = { [appConfig.creatorAccount]: dataJSON };

  widgetFiles.forEach((file) => {
    let fileContent = fs.readFileSync(file, "utf8");
    let widgetPath = file
      .replace(`./${distFolder}/${workspaceFolder}/src/`, "")
      .replace(path.extname(file), "");

    const windowsWidgetPath = widgetPath.replaceAll("/", ".");
    const linuxWidgetPath = widgetPath.split(path.sep).join(".");

    let widgetKey = `${appConfig.creatorAccount}/widget/${
      process.platform === "win32" ? windowsWidgetPath : linuxWidgetPath
    }`;
    console.log(widgetKey);
    devJson.components[widgetKey] = { code: fileContent };
  });

  return devJson;
}

// watch for changes in the specified folders and run the callback
function watchFolders(folders, callback) {
  const watcher = chokidar.watch(folders, { persistent: true });

  watcher.on("change", (path) => {
    callback(path);
  });
}

// serves the development json
function serveDevJson() {
  const app = express();

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Content-Length, X-Requested-With"
    );

    next();
  });

  app.get("/", (req, res) => {
    let devJson = { components: {}, data: {} };
    const workspaceFolders = fs.readdirSync("./workspaces");

    for (const workspaceFolder of workspaceFolders) {
      let appDevJson = generateDevJson(workspaceFolder);
      devJson.components = { ...devJson.components, ...appDevJson.components };
      devJson.data = { ...devJson.data, ...appDevJson.data };
    }

    res.json(devJson);
  });

  const port = process.env.BOS_PORT || 4040; 

  app.listen(port, "127.0.0.1", () => {
    console.log(
      "\n|--------------------------------------------\\\n|",
      "Server running at " + `http://127.0.0.1:${port}/` + "\n|\n|",
      "To use the local widgets, go to " + "https://near.org/flags" + "\n|",
      "and paste the server link above.\n|",
      "--------------------------------------------\\\n"
    );
  });
}

// TODO: need tests
function deployApp(workspaceFolder) {
  const config = readBosConfig(workspaceFolder);
  const creatorAccount = config.creatorAccount;

  if (!creatorAccount) {
    console.error(
      `App account is not defined for ${workspaceFolder}. Skipping deployment.`
    );
    return;
  }

  const packageRoot = path.resolve(__dirname, "..");
  const bosBinaryPath = path.join(packageRoot, "node_modules", ".bin", "bos");

  const command = [
    bosBinaryPath,
    "components",
    "deploy",
    `'${creatorAccount}'`,
    "sign-as",
    `'${creatorAccount}'`,
    "network-config",
    "mainnet",
  ].join(" ");

  try {
    execSync(command, {
      cwd: path.join(distFolder, workspaceFolder),
      stdio: "inherit",
    }).toString();
    console.log(`Deployed ${workspaceFolder}`);
  } catch (error) {
    console.error(`Error deploying ${workspaceFolder} widgets:\n${error.message}`);
  }
}

function uploadData(workspaceFolder) {
  const config = readBosConfig(workspaceFolder);
  const creatorAccount = config.creatorAccount;

  if (!creatorAccount) {
    console.error(
      `App account is not defined for ${workspaceFolder}. Skipping data upload.`
    );
    return;
  }

  const dataJSON = fs.readFileSync(
    path.join(distFolder, workspaceFolder, "data.json"),
    "utf8"
  );
  const args = {
    data: {
      [creatorAccount]: JSON.parse(dataJSON),
    },
  };

  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");

  const packageRoot = path.resolve(__dirname, "..");
  const nearBinaryPath = path.join(packageRoot, "node_modules", ".bin", "near");

  const command = [
    nearBinaryPath,
    "contract",
    "call-function",
    "as-transaction",
    "social.near",
    "set",
    "base64-args",
    `'${argsBase64}'`,
    "prepaid-gas",
    "'300.000 TeraGas'",
    "attached-deposit",
    "'0.001 NEAR'",
    "sign-as",
    creatorAccount,
    "network-config",
    "mainnet",
  ].join(" ");

  try {
    execSync(command, {
      cwd: path.join(distFolder, workspaceFolder),
      stdio: "inherit",
    }).toString();
    console.log(`Uploaded data for ${workspaceFolder}`);
  } catch (error) {
    console.error(`Error uploading data for ${workspaceFolder}:\n${error.message}`);
  }
}

function workspaceSelectorCLI(callback) {
  const workspaceFolders = fs.readdirSync("./workspaces");

  // Check if workspaceFolder is provided as a command line argument
  const specifiedworkspaceFolder = process.argv[2];

  if (specifiedworkspaceFolder && workspaceFolders.includes(specifiedworkspaceFolder)) {
    callback(specifiedworkspaceFolder);
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Please select an app:");
  workspaceFolders.forEach((folder, index) => {
    console.log(`${index + 1}. ${folder}`);
  });

  rl.question("Enter the number of the app you want to use: ", (answer) => {
    const appIndex = parseInt(answer, 10) - 1;
    if (appIndex >= 0 && appIndex < workspaceFolders.length) {
      const workspaceFolder = workspaceFolders[appIndex];
      callback(workspaceFolder);
      rl.close();
    } else {
      console.error("Invalid selection. Exiting.");
      rl.close();
    }
  });
}

function deployCLI() {
  workspaceSelectorCLI(deployApp);
}

function uploadDataCLI() {
  workspaceSelectorCLI(uploadData);
}

// Main function to orchestrate the dev script
async function dev() {
  // the first build,
  await build();

  // Start serving the development JSON
  serveDevJson();

  setTimeout(() => {
    console.log("\nWatching for changes in the following folders");
    console.log(["./workspaces", "./modules"].join("\n"), "\n");
  }, 1000);
  watchFolders(["./workspaces", "./modules"], async (path) => {
    console.log(`\nChange detected in ${path}`);
    await build();
    console.log("Completed build successfully");
  });
}

// Main function to orchestrate the build script
async function build() {
  const workspaceFolders = fs.readdirSync("./workspaces");

  for (const workspaceFolder of workspaceFolders) {
    console.log(`Building ${workspaceFolder}...`);
    generateDistFolder(workspaceFolder);
    processDistFolder(workspaceFolder);
    generateDataJson(workspaceFolder);
  }
}

// exports
module.exports = {
  readBosConfig,
  processCommentCommands,
  importModules,
  shouldSkipFile,
  processFile,
  processDistFolder,
  generateDistFolder,
  generateDataJson,
  generateDevJson,
  build,
  dev,
  deployCLI,
  deployApp,
  uploadDataCLI,
  uploadData,
};
