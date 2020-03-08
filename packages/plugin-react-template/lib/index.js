const getNpmCommand = require('@a8k/cli-utils/npm');
const { spinner } = require('@a8k/common');
const spawn = require('@a8k/cli-utils/spawn');

const shell = require('shelljs');
const util = require('util');
const createGenerator = require('./create');
const addComponent = require('./add-component');
const addPage = require('./add-page');

module.exports = class PluginReact {
  constructor(options) {
    this.name = 'builtin:react';
    this.options = options;
  }

  apply(context) {
    context.registerCreateType('react', '基于react的项目(支持SSR)', async ({ projectDir, name }) => {
      await createGenerator(projectDir, name);
      await context.hooks.invokePromise('afterCreate', context);
      spinner.succeed('File Generate Done');
      const npmCmd = getNpmCommand();
      shell.cd(projectDir);
      await spawn(npmCmd, ['i'], { cwd: projectDir });

      spinner.succeed('安装依赖完毕');
      try {
        await util.promisify(shell.exec)('npx eslint --fix src  a8k.config.js  --ext jsx,js');
        spinner.succeed('执行eslint校验');
      } catch (e) {
        spinner.warn('执行eslint校验失败');
      }
      await context.hooks.invokePromise(context);
      spinner.succeed('项目创建完毕');
    });
    context.registerPageType('react', '创建react项目page', async () => {
      addPage(context);
      await context.hooks.invokePromise('afterAddPage', context);
    });
    context.registerComponentType('react', '创建react项目component', async () => {
      addComponent(context);
      await context.hooks.invokePromise('afterAddComponent', context);
    });
  }
};
