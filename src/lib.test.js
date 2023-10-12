const mockFs = require("mock-fs");
const fs = require("fs");
const path = require("path");
const DIST_FOLDER = ".__test_dist__";
process.env.DIST_FOLDER = DIST_FOLDER;

const {
  readBosConfig,
  getNetworkAccount,
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
} = require("./lib.js");

beforeEach(() => {
  mockFs({
    "./workspaces/testWorkspaceFolder": {
      "bos.config.json": JSON.stringify({
        creatorAccount: "test",
        aliases: {
          test: "testAlias",
          nui: "nui.near",
        },
      }),
      widget: {
        "test.js":
          'console.log("/*__@replace:test__*/");<Widget src="/*__@replace:nui__*//widget/index" />',
        "skip.js": '/*__@skip__*/console.log("Hello");/*__@replace:nui__*/',
      },
      "test.jsonc": "{}",
      "ignore.jsonc": "/*__@ignore__*/{}",
      "hello.txt": "Hello, World!",
      "donothing.json": "{hi: 1}",
    },
    "./modules": {
      "module1.js": "module1 content",
    },
    ["./" + DIST_FOLDER]: {},
  });
});

afterEach(mockFs.restore);

describe("Library Function Tests", () => {
  describe("readBosConfig", () => {
    it("reads the bos.config.json file correctly", () => {
      const config = readBosConfig("testWorkspaceFolder");
      expect(config).toEqual({
        creatorAccount: "test",
        aliases: { test: "testAlias", nui: "nui.near" },
      });
    });
  });

  describe("getNetworkAccount", () => {
    afterEach(() => {
      jest.resetModules();
      delete process.env.NETWORK_ID;
    });

    it("returns null when creatorAccount is not provided", () => {
      const result = getNetworkAccount();
      expect(result).toBe(null);
    });

    it("returns creatorAccount itself when it's a string", () => {
      const result = getNetworkAccount("account123");
      expect(result).toBe("account123");
    });

    it("uses process.env.NETWORK_ID as a key", () => {
      process.env.NETWORK_ID = "testnet";
      const result = getNetworkAccount({ testnet: "testAccount" });
      expect(result).toBe("testAccount");
    });

    it("defaults to 'mainnet' when NETWORK_ID is not set", () => {
      const result = getNetworkAccount({ mainnet: "mainAccount" });
      expect(result).toBe("mainAccount");
    });

    it("logs an error and returns null when the key doesn't exist", () => {
      console.error = jest.fn();

      const result = getNetworkAccount({ someNet: "someAccount" });

      expect(console.error).toHaveBeenCalledWith(
        "mainnet value is not specified in creatorAccount."
      );
      expect(result).toBe(null);
    });
  });

  describe("processCommentCommands", () => {
    it("processes the comment commands correctly", () => {
      const aliases = { test: "testAlias" };
      const creatorAccount = "testAccount";
      const fileContent =
        'console.log("/*__@replace:test__*/"); console.log("/*__@creatorAccount__*/");';
      const result = processCommentCommands(
        fileContent,
        aliases,
        creatorAccount
      );
      expect(result).toEqual(
        'console.log("testAlias"); console.log("testAccount");'
      );
    });

    it("returns original content when no aliases are found", () => {
      const aliases = { test: "testAlias" };
      const creatorAccount = "testAccount";
      const fileContent = 'console.log("Hello, World!");';
      const result = processCommentCommands(
        fileContent,
        aliases,
        creatorAccount
      );
      expect(result).toEqual('console.log("Hello, World!");');
    });
  });

  describe("importModules", () => {
    it("imports module content correctly", () => {
      const fileContent = 'console.log("/*__@import:module1__*/");';
      const result = importModules(fileContent);
      expect(result).toEqual('console.log("module1 content");');
    });

    it("throws an error when a module does not exist", () => {
      const fileContent = 'console.log("/*__@import:nonexistentModule__*/");';
      expect(() => importModules(fileContent)).toThrow();
    });
  });

  describe("shouldSkipFile", () => {
    it("identifies files that should be skipped", () => {
      expect(
        shouldSkipFile('console.log("Hello"); /*__@skip__*/')
      ).toBeTruthy();
      expect(shouldSkipFile('console.log("Hello");')).toBeFalsy();
    });
  });

  describe("processFile", () => {
    let writeFileSyncSpy;

    beforeEach(() => {
      writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    });

    afterEach(() => {
      writeFileSyncSpy.mockRestore();
    });

    it("processes a file correctly", () => {
      processFile(
        "./workspaces/testWorkspaceFolder/widget/test.js",
        {
          test: "testAlias",
          nui: "nui.near",
        },
        "testAccount"
      );
      expect(writeFileSyncSpy).toHaveBeenCalledWith(
        "./workspaces/testWorkspaceFolder/widget/test.js",
        'console.log("testAlias");<Widget src="nui.near/widget/index" />'
      );
    });

    it("does not modify the file when it should be skipped", () => {
      processFile(
        "./workspaces/testWorkspaceFolder/widget/skip.js",
        {
          test: "testAlias",
          nui: "nui.near",
        },
        "testAccount"
      );
      expect(writeFileSyncSpy).not.toHaveBeenCalled();
    });
  });

  describe("processDistFolder", () => {
    it("processes an app folder correctly", async () => {
      const spy = jest.spyOn(fs, "writeFileSync");
      await generateDistFolder("testWorkspaceFolder");
      await processDistFolder("testWorkspaceFolder");
      expect(spy).toHaveBeenCalledWith(
        `./${DIST_FOLDER}/testWorkspaceFolder/src/test.js`,
        'console.log("testAlias");<Widget src="nui.near/widget/index" />'
      );
    });
  });

  describe("generateDistFolder", () => {
    it("generates the build folder structure correctly", () => {
      const spyc = jest.spyOn(fs, "copyFileSync");
      const spym = jest.spyOn(fs, "mkdirSync");
      generateDistFolder("testWorkspaceFolder");
      expect(spym).toHaveBeenCalledWith(
        path.join(DIST_FOLDER, "testWorkspaceFolder"),
        {
          recursive: true,
        }
      );
      expect(spyc.mock.calls).toEqual([
        [
          "./workspaces/testWorkspaceFolder/widget/skip.js",
          "./" + DIST_FOLDER + "/testWorkspaceFolder/src/skip.js",
        ],
        [
          "./workspaces/testWorkspaceFolder/widget/test.js",
          "./" + DIST_FOLDER + "/testWorkspaceFolder/src/test.js",
        ],
      ]);
    });
  });

  describe("generateDataJson", () => {
    let writeFileSyncSpy;

    beforeEach(() => {
      writeFileSyncSpy = jest.spyOn(fs, "writeFileSync");
    });

    afterEach(() => {
      writeFileSyncSpy.mockRestore();
    });

    it("generates data.json file correctly", () => {
      generateDataJson("testWorkspaceFolder");
      
      const hasExpectedCall = writeFileSyncSpy.mock.calls.some(call => call[0] === path.join(DIST_FOLDER, "testWorkspaceFolder", "data.json"));
      expect(hasExpectedCall).toBeTruthy();

      const hasExpectedContent = writeFileSyncSpy.mock.calls.some(call => call[1].replace(/\s+/g, "") === '{"hello":"Hello,World!","test":"{}"}');
      expect(hasExpectedContent).toBeTruthy();
    });
  });

  describe("generateDevJson", () => {
    it("generates the development JSON correctly", async () => {
      // mock a nested component
      fs.mkdirSync("./workspaces/testWorkspaceFolder/widget/Layout/Modal", {
        recursive: true,
      });
      fs.writeFileSync(
        "./workspaces/testWorkspaceFolder/widget/Layout/Modal/index.jsx",
        'return console.log("/*__@replace:test__*/");<Widget src="/*__@replace:nui__*//widget/index" />'
      );

      // first, build the app
      await generateDistFolder("testWorkspaceFolder");
      await processDistFolder("testWorkspaceFolder");
      await generateDataJson("testWorkspaceFolder");

      const devJson = generateDevJson("testWorkspaceFolder");

      // verify the structure of the devJson
      expect(devJson).toHaveProperty("components");
      expect(devJson).toHaveProperty("data");

      // verify the content of the component file
      expect(devJson.components["test/widget/Layout.Modal.index"].code).toEqual(
        'return console.log("testAlias");<Widget src="nui.near/widget/index" />'
      );
      expect(devJson.data).toEqual({
        test: {
          hello: "Hello, World!",
          test: "{}",
        },
      });
    });
  });

  // TODO: properly test the dev function
  // describe("dev", () => {
  //   it("executes the dev script correctly", async () => {
  //     await dev();
  //     setTimeout(() => {
  //       throw "Force dev script to exit";
  //     }, 3000);
  //   });
  // });

  describe("build", () => {
    it("executes the build script correctly", async () => {
      const spyw = jest.spyOn(fs, "writeFileSync");
      const spyc = jest.spyOn(fs, "copyFileSync");
      const spym = jest.spyOn(fs, "mkdirSync");

      await build();
      expect(spym).toHaveBeenCalledWith(
        path.join(DIST_FOLDER, "testWorkspaceFolder"),
        {
          recursive: true,
        }
      );
      expect(spyc).toHaveBeenCalledWith(
        "./workspaces/testWorkspaceFolder/widget/test.js",
        `./${DIST_FOLDER}/testWorkspaceFolder/src/test.js`
      );
      expect(spyw).toHaveBeenCalledWith(
        `./${DIST_FOLDER}/testWorkspaceFolder/src/test.js`,
        'console.log("testAlias");<Widget src="nui.near/widget/index" />'
      );
      expect(spyw.mock.calls[spyw.mock.calls.length - 1][0]).toBe(
        path.join(DIST_FOLDER, "/testWorkspaceFolder/data.json")
      );
      expect(
        spyw.mock.calls[spyw.mock.calls.length - 1][1].replace(/\s+/g, "")
      ).toBe('{"hello":"Hello,World!","test":"{}"}');
    });
  });
});
