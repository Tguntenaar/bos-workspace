import { ensureDir, outputFile } from "@/lib/utils/fs";
import path from "path";

const templates = {
  "js-single": {
    "./bos.config.json": JSON.stringify({
      account: "bosworkspace",
    }),
    "./aliases.json": JSON.stringify({
      "name": "My App",
    }),
    "./module/hello.js": "const hello = () => `Welcome to ${alias/name}, ${config/account}!`; export { hello };",
    "./widget/home.metadata.json": JSON.stringify({
      name: "Hello",
      description: "Hello world widget",
    }),
    "./widget/home.tsx": "const { hello } = VM.require('${module/hello/utils.ts}'); return hello();",
  },
  "js-multi": {
    "./bos.workspace.json": JSON.stringify({
      apps: ["./app1", "./app2"],
    }),
    "./app1/bos.config.json": JSON.stringify({
      account: "app1.near",
    }),
    "./app1/aliases.json": JSON.stringify({
      "name": "App 1",
    }),
    "./app1/widget/home.jsx": "return <h1>Hello, ${alias/name}!</h1>;",
    "./app1/widget/home.metadata.json": JSON.stringify({
      name: "Hello",
      description: "Hello world widget",
    }),
    "./app2/bos.config.json": JSON.stringify({
      account: "app2.near",
    }),
    "./app2/aliases.json": JSON.stringify({
      "name": "App 2",
    }),
    "./app2/widget/home.jsx": "return <h1>Hello, ${alias/name}!</h1>;",
    "./app2/widget/home.metadata.json": JSON.stringify({
      name: "Hello",
      description: "Hello world widget",
    }),
  }
};

// TODO: WIP
export async function initProject(pwd: string, template: keyof typeof templates = "js-single") {
  try {
    await Promise.all(Object.entries(templates[template]).map(async ([relativePath, content]) => {
      const fullPath = path.join(pwd, relativePath);

      const dir = path.dirname(fullPath);

      await ensureDir(dir);
      await outputFile(fullPath, content);
    }));

    console.log('Project initialization complete.');
  } catch (error) {
    console.error('Error during project initialization:', error);
  }
}