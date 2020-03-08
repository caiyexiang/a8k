import loadConfig from '@a8k/cli-utils/load-config';
import { logger, spinner } from '@a8k/common';
import { BUILD_ENV, BUILD_TARGET } from '@a8k/common/lib/constants';
import program, { Command } from 'commander';
import fs from 'fs-extra';
import globalModules from 'global-modules';
import inquirer from 'inquirer';
import { merge } from 'lodash';
import path from 'path';
import resolveFrom from 'resolve-from';
import webpack from 'webpack';
import WebpackChain from 'webpack-chain';
import defaultConfig, { ssrConfig } from './default-config';
import Hooks from './hooks';
import { A8kConfig, A8kOptions, Internals, IResolveWebpackConfigOptions } from './interface';
import create from './utils/create-by-template';
import download from './utils/download';
import getFilenames from './utils/get-filenames';
import { getConfig, setConfig } from './utils/global-config';
import loadPkg from './utils/load-pkg';
import loadPlugins from './utils/load-plugins';
import { GenerateLoaders } from './webpack/rules/generate-loaders';

const { version } = require('../package.json');

program.version(version);

program.option('--nochecklatest', '不检测最新版本');
program.option('--debug', '输出构建调试信息');
program.option('--npm-client <npmClient>', '自定义npm命令');
program.option('--config <configPath>', '自定义a8k.config.js');
program.on('command:*', () => {
  logger.error(`Invalid command: ${program.args.join(' ')}\nSee --help for a list of available commands.`);
  process.exit(1);
});

type ActionFunction = (options: any) => void;
type ActionCreateFunction = (options: { name: string; projectDir: string; type: string }) => void;
export default class A8k {
  public logger: any = logger;
  public options: A8kOptions;
  public config: A8kConfig;
  public hooks = new Hooks();
  public commands = new Map();
  public cli = program;
  public internals: Internals;
  public buildId: string;
  public pkg: any;
  public configFilePath = '';
  public plugins: any[] = [];
  private pluginsSet = new Set<string>();
  private inspectConfigPath = '';
  private createProjectCommandTypes: Array<{
    type: string;
    description: string;
    action: ActionCreateFunction;
  }> = [];

  private createPageCommand: Array<{
    type: string;
    description: string;
    action: ActionFunction;
  }> = [];

  private createComponentCommand: Array<{
    type: string;
    description: string;
    action: ActionFunction;
  }> = [];

  constructor(options: A8kOptions) {
    this.options = {
      cliPath: path.resolve(__dirname, '../'),
      cliArgs: process.argv,
      baseDir: path.resolve('.'),
    } as A8kOptions;
    if (options) {
      this.options = { ...this.options, ...options };
      if (this.options.baseDir) {
        this.options.baseDir = path.resolve(this.options.baseDir);
      }
    }
    const { baseDir, debug } = this.options;
    logger.setOptions({
      debug,
    });
    this.config = {} as A8kConfig;

    this.internals = {
      mode: BUILD_ENV.DEVELOPMENT,
    };

    this.buildId = Math.random()
      .toString(36)
      .substring(7);
    this.pkg = loadPkg({ cwd: baseDir });

    this.initConfig();
  }

  public initConfig() {
    const { baseDir, configFile } = this.options;
    if (configFile) {
      if (!fs.existsSync(this.resolve(configFile))) {
        logger.error(configFile + ' not found');
        process.exit(-1);
      }
    }
    const res = loadConfig.loadSync({
      files: typeof configFile === 'string' ? [configFile] : ['a8k.config.js', 'imtrc.js', 'package.json'],
      cwd: baseDir,
      packageKey: 'a8k',
    });
    let { config } = this;
    if (res.path) {
      this.configFilePath = res.path;
      config = merge(res.data, config);
      logger.debug(`a8k config file: ${this.configFilePath}`);
    } else {
      logger.debug('a8k is not using any config file');
    }
    // TODO: remove
    if (config.ssrDevServer) {
      logger.warn('ssrDevServer Deprecated ,instead of ssrConfig');
      config.ssrConfig = { ...config.ssrDevServer };
    }
    if (config.ssrConfig) {
      config.ssrConfig = { ...ssrConfig, ...config.ssrConfig };
    }
    config = merge(defaultConfig, config);

    // 构建输出文件根目录
    config.dist = this.resolve(config.dist);
    // 页面根目录
    config.pagesPath = this.resolve(config.pagesPath);
    if (config.initEntry) {
      // 处理公共entry
      config.initEntry = config.initEntry.map((i: string) => this.resolve(i));
    }
    // html模板路径
    config.template = this.resolve(config.template);
    // 缓存版本标记
    config.cacheDirectory = path.resolve(config.cacheDirectory);
    // 默认值必须是"/"
    config.publicPath = config.publicPath || '/';
    if (config.ssrConfig) {
      // ssr配置
      config.ssrConfig.entryPath = this.resolve(config.ssrConfig.entryPath);
      config.ssrConfig.viewPath = this.resolve(config.ssrConfig.viewPath);
    }
    if (process.env.HOST) {
      config.devServer.host = process.env.HOST;
    }
    if (process.env.PORT) {
      config.devServer.port = Number(process.env.PORT);
    }
    config.envs = { ...config.envs, ...this.loadEnvs() };
    this.config = config;
  }

  public hook(name: string, fn: Function) {
    return this.hooks.add(name, fn);
  }

  public resolve(...args: string[]) {
    return path.resolve(this.options.baseDir, ...args);
  }

  public rootResolve(...args: string[]) {
    return path.resolve(this.options.cliPath, ...args);
  }

  // 准备工作
  public prepare() {
    this.registerCommand('create [dir] [type]')
      .description('create project')
      .action(async (dir, type) => {
        // start: pull remote template list
        spinner.logWithSpinner('pull template list...');
        const { path: tmpDir, cleanupCallback } = await download('https://github.com/a8k/template.git');

        const templateList: Array<{
          type: string;
          name: string;
          description: string;
          url: string;
        }> = require(tmpDir);
        spinner.succeed('pull template list success');

        templateList.map(item => {
          this.createProjectCommandTypes.push({
            type: item.type,
            description: item.name,
            // tslint:disable-next-line: no-shadowed-variable
            action: ({ projectDir }) => {
              create(projectDir, item.url, this);
            },
          });
        });

        // end

        const projectDir = path.join(this.options.baseDir, dir || '');
        try {
          await fs.stat(projectDir);
          const files = await fs.readdir(projectDir);
          if (files.length) {
            const answer: any = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'continue',
                message: 'current directory not empty, continue?',
                default: false,
              },
            ]);
            if (!answer.continue) {
              process.exit(0);
            }
          }
        } catch (e) {
          //
        }

        if (!type) {
          const prompts: any = [
            {
              choices: this.createProjectCommandTypes.map(({ type, description }) => {
                return { name: description, value: type };
              }),
              message: 'select you want create project type',
              name: 'type',
              type: 'list',
            },
          ];
          const result: any = await inquirer.prompt(prompts);
          type = result.type;
        }
        let name = path.basename(projectDir);
        const prompt: any = [
          {
            type: 'input',
            name: 'name',
            validate(input: string) {
              // Declare function as asynchronous, and save the done callback
              const done = (this as any).async();

              if (input !== '' && /^[a-z@A-Z]/.test(input)) {
                done(null, true);
              } else {
                done('Project name must begin with a letter or @');
              }
            },
            message: 'Input project name',
            default: name,
          },
        ];
        ({ name } = await inquirer.prompt(prompt));
        const commandType = this.createProjectCommandTypes.find(({ type: c }) => c === type);
        if (!commandType) {
          logger.error(`create "${type}" not support`);
          process.exit(-1);
        } else {
          spinner.info(commandType.description);
          fs.ensureDir(projectDir);
          commandType.action({
            name,
            projectDir,
            type,
          });
        }
        cleanupCallback();
      });
    this.registerCommand('page')
      .alias('p')
      .description('create page from template')
      .action(async () => {
        if (!this.config.type) {
          logger.warn('you project not support this command');
          return;
        }
        const command = this.createPageCommand.find(({ type }) => type === this.config.type);
        if (command) {
          command.action({});
        } else {
          logger.warn('you project(type is ' + this.config.type + ') not support create page');
        }
      });
    this.registerCommand('component')
      .alias('c')
      .description('create component from template')
      .action(async () => {
        if (!this.config.type) {
          logger.warn('you project not support this command');
          return;
        }
        const command = this.createComponentCommand.find(({ type }) => type === this.config.type);
        if (command) {
          command.action({});
        } else {
          logger.warn('you project(type is ' + this.config.type + ') not support create component');
        }
      });
    this.applyPlugins();
    this.registerCommand('plugin <type> [pluginName]')
      .description('编辑全局插件列表，模板插件可以添加到全局')
      .action((type: string, pluginName: string) => {
        const plugins: string[] = getConfig('plugins', []);
        switch (type) {
          case 'add':
            if (!pluginName) {
              logger.error('pluginName param not found');
              return;
            }
            spinner.logWithSpinner('check plugin ' + pluginName);
            if (plugins.indexOf(pluginName) >= 0) {
              spinner.stop();
              logger.info(pluginName + ' exists ');
              return;
            }
            try {
              resolveFrom(globalModules, pluginName);
            } catch (e) {
              spinner.fail();
              logger.error(pluginName + ' plugin not found from ' + globalModules);
              return;
            }
            spinner.succeed();
            plugins.push(pluginName);
            setConfig('plugins', plugins);
            spinner.succeed(pluginName + ' success add to global config');
            break;
          case 'delete':
            if (!pluginName) {
              logger.error('pluginName param not found');
              return;
            }
            setConfig(
              'plugins',
              plugins.filter((p: string) => p !== pluginName)
            );
            break;
          case 'ls':
          case 'list':
            console.log('plugin list:');
            plugins.forEach((name: string) => {
              console.log();
              console.log(name);
            });
            console.log();
            console.log('plugin total: ' + plugins.length);
            break;
          default:
            console.log('only support type: add,delete,list');
        }
      });

    logger.debug('App envs', JSON.stringify(this.getEnvs(), null, 2));
  }

  public loadEnvs() {
    const { NODE_ENV } = process.env;
    const dotenvPath = this.resolve('.env');
    const dotenvFiles: any[] = [
      NODE_ENV && `${dotenvPath}.${NODE_ENV}.local`,
      NODE_ENV && `${dotenvPath}.${NODE_ENV}`,
      // Don't include `.env.local` for `test` environment
      // since normally you expect tests to produce the same
      // results for everyone
      NODE_ENV !== 'test' && `${dotenvPath}.local`,
      dotenvPath,
    ].filter(Boolean);

    let envs: any = {};

    dotenvFiles.forEach((dotenvFile: string) => {
      if (fs.existsSync(dotenvFile)) {
        logger.debug('Using env file:', dotenvFile);
        const config = require('dotenv-expand')(
          require('dotenv').config({
            path: dotenvFile,
          })
        );
        // Collect all variables from .env file
        envs = { ...envs, ...config.parsed };
      }
    });

    // Collect those temp envs starting with a8k_ too
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('a8k_')) {
        envs[name] = process.env[name];
      }
    }

    return envs;
  }

  // Get envs that will be embed in app code
  public getEnvs() {
    return Object.assign({}, this.config.envs, {
      PUBLIC_PATH: this.config.publicPath,
    });
  }

  private applyPlugins() {
    const buildInPlugins = [
      [require('@a8k/plugin-react-template'), []],
      [require('@a8k/plugin-typescript-template'), []],
      [require('./plugins/command-create'), []],
      require('./plugins/config-base'),
      require('./plugins/config-dev'),
      require('./plugins/config-html'),
      require('./plugins/config-ssr'),
      require('./plugins/command-build'),
      require('./plugins/command-dev'),
      require('./plugins/command-test'),
      require('./plugins/command-utils'),
      require('./plugins/command-init'),
      // [require('@a8k/plugin-sb-react'), []],// 暂时禁用story-book能力，待完善
    ];
    const { baseDir } = this.options;
    this.initPlugins(loadPlugins(buildInPlugins, baseDir), 'build-in');
    this.initPlugins(loadPlugins(this.config.plugins || [], baseDir), 'custom');
    const globalPlugins = getConfig('plugins') || [];
    try {
      this.initPlugins(loadPlugins(globalPlugins, globalModules), 'global');
    } catch (e) {
      logger.error('global init error');
      console.log('global plugin list:');
      globalPlugins.forEach((name: string) => console.log(name));
      console.error(e);
    }
  }

  private initPlugins(plugins: any, type: string) {
    for (const [Plugin, options = [], resolve] of plugins) {
      let pluginInst = null;
      if (Plugin instanceof Function) {
        pluginInst = new Plugin(...options);
      } else {
        pluginInst = Plugin;
      }
      const pluginName = pluginInst.name || Plugin.name;
      if (!pluginName) {
        throw new Error('plugin name not found\n' + Plugin);
      }
      this.plugins.push({ pluginName, pluginInst });
      if (this.pluginsSet.has(pluginName)) {
        logger.warn('[' + type + '] "' + pluginName + '" plugin name have exists\n' + resolve);
      } else {
        try {
          pluginInst.apply(this, ...options);
        } catch (e) {
          logger.error('plugin ' + (resolve || '') + ' apply error ');
          throw e;
        }
        logger.debug('[' + type + ']use plugin ' + pluginName);
        this.pluginsSet.add(pluginName);
      }
    }
  }

  // 程序入口
  public async run() {
    this.prepare();
    await this.hooks.invokePromise('beforeRun');
    this.cli.parse(this.options.cliArgs);
    if (!this.options.cliArgs.slice(2).length) {
      program.outputHelp();
    }
  }

  public async resolveWebpackConfig(options: IResolveWebpackConfigOptions) {
    const configChain = new WebpackChain();

    options = {
      type: BUILD_TARGET.WEB,
      ...options,
      mode: this.internals.mode,
    };
    // 生产模式和dev服务器渲染调试时，开启这个模式防止样式抖动
    options.extractCss = this.config.extractCss && (options.mode === BUILD_ENV.PRODUCTION || !!options.ssr);

    this.config.filenames = getFilenames(
      {
        filenames: this.config.filenames,
        mode: options.mode,
      },
      options
    );
    await this.hooks.invokePromise('chainWebpack', configChain, options, this);

    if (this.config.chainWebpack) {
      await this.config.chainWebpack(configChain, options, this);
    }

    if (this.options.inspect) {
      this.inspectConfigPath = path.join(
        require('os').tmpdir(),
        `a8k-inspect-webpack-config-${options.type}-${this.buildId}.js`
      );
      fs.appendFileSync(
        this.inspectConfigPath,
        `//${JSON.stringify(options)}\nconst ${options.type} = ${configChain.toString()}\n`
      );
      require('open')(this.inspectConfigPath);
    }

    let webpackConfig = configChain.toConfig();
    if (this.config.webpackOverride) {
      logger.warn('!!webpackOverride 已经废弃，请使用chainWebpack修改配置!!');
      // 兼容旧版本imt
      const legacyOptions = {
        type: options.type === BUILD_TARGET.WEB ? options.mode : 'server',
      };
      const modifyConfig = this.config.webpackOverride(webpackConfig, legacyOptions);
      if (modifyConfig) {
        webpackConfig = modifyConfig;
      }
    }
    return webpackConfig;
  }

  public createWebpackCompiler(webpackConfig: webpack.Configuration) {
    return require('webpack')(webpackConfig);
  }

  public async runWebpack(webpackConfig: webpack.Configuration) {
    const compiler = this.createWebpackCompiler(webpackConfig);
    await new Promise((resolve, reject) => {
      compiler.run((err: Error, stats: any) => {
        if (err) {
          return reject(err);
        }
        resolve(stats);
      });
    });
  }

  public async runCompiler(compiler: webpack.Compiler) {
    await new Promise((resolve, reject) => {
      compiler.run((err: Error, stats: any) => {
        if (err) {
          return reject(err);
        }
        resolve(stats);
      });
    });
  }

  public hasDependency(name: string, type = 'all') {
    const prodDeps = Object.keys(this.pkg.data.dependencies || {});
    const devDeps = Object.keys(this.pkg.data.devDependencies || {});
    if (type === 'all') {
      return prodDeps.concat(devDeps).includes(name);
    }
    if (type === 'prod') {
      return prodDeps.includes(name);
    }
    if (type === 'dev') {
      return devDeps.includes(name);
    }
    throw new Error(`Unknow dep type: ${type}`);
  }

  public registerCommand(command: string): Command {
    return this.cli.command(command);
  }

  public registerCreateType(type: string, description: string, action: ActionCreateFunction): A8k {
    this.createProjectCommandTypes.push({ type, description, action });
    return this;
  }

  public registerPageType(type: string, description: string, action: ActionFunction): A8k {
    this.createPageCommand.push({ type, description, action });
    return this;
  }

  public registerComponentType(type: string, description: string, action: ActionFunction): A8k {
    this.createComponentCommand.push({ type, description, action });
    return this;
  }

  public chainWebpack(fn: (configChain: WebpackChain, options: IResolveWebpackConfigOptions) => void) {
    this.hooks.add('chainWebpack', fn);
    return this;
  }

  public localResolve(id: string, fallbackDir: string) {
    let resolved = resolveFrom.silent(this.resolve(), id);
    if (!resolved && fallbackDir) {
      resolved = resolveFrom.silent(fallbackDir, id);
    }
    return resolved;
  }

  public localRequire(id: string, fallbackDir: string) {
    const resolved = this.localResolve(id, fallbackDir);
    return resolved && require(resolved);
  }

  /**
   *  用于生成自定义的css-处理器
   *  支持postcss/sass/less预处理器
   * @param name 命名，比如: sass
   * @param test rule.test规则
   * @param configChain  WebpackChain
   * @param options IResolveWebpackConfigOptions
   * @returns {GenerateLoaders}
   */
  public genCssLoader(
    name: string,
    test: any,
    configChain: WebpackChain,
    options: IResolveWebpackConfigOptions
  ): GenerateLoaders {
    const rule = configChain.module.rule(name).test(test);
    return new GenerateLoaders(rule, this, options);
  }
}
