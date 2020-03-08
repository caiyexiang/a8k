const semver = require('semver');
const chalk = require('chalk');

const Generator = require('yeoman-generator');
const { join } = require('path');
const { logger } = require('@a8k/common');
const { toArray, createExampleComponent, createMultiExamplePage, createSingleExamplePage } = require('./heper');

// debug.enabled = true;

class CreateGenerator extends Generator {
  constructor(args, opts) {
    super(args, opts);
    this.name = args.name;
    this.props = { ssr: false, type: 'react' };
    this.sourceRoot(join(__dirname, '../templates/'));
  }

  async prompting() {
    const prompts = [
      {
        name: 'app',
        message: 'select application type',
        type: 'list',
        choices: [
          { name: 'multi page application', value: 'multi' },
          { name: 'single page application', value: 'single' },
        ],
      },
    ];
    const { app } = await this.prompt(prompts);
    const { rem } = await this.prompt([
      {
        name: 'rem',
        message: '是否添加rem脚本，用于h5适配屏幕开发？',
        type: 'confirm',
        default: false,
      },
    ]);
    const { retry } = await this.prompt([
      {
        name: 'retry',
        message: '是否支持主域重试？解决CDN失败后自动加载主域资源',
        type: 'confirm',
        default: false,
      },
    ]);
    if (app === 'multi') {
      // 暂无配置
      const { ssr } = await this.prompt([
        {
          name: 'ssr',
          message: '是否启用服务器渲染(直出)?',
          type: 'confirm',
          default: true,
        },
      ]);
      this.props.ssr = ssr;
      if (ssr) {
        const { nodeFramework } = await this.prompt([
          {
            name: 'nodeFramework',
            message: '使用koa or express',
            type: 'list',
            choices: [
              { name: 'koa', value: 'koa' },
              { name: 'express', value: 'express' },
            ],
          },
        ]);
        this.props.nodeFramework = nodeFramework;
      }
    } else {
      let htmlConfig = {
        keywords: 'react,a8k',
        title: 'a8k application',
        description: 'a8k application',
      };

      const { html } = await this.prompt([
        {
          name: 'html',
          message: '是否初始化index.html配置？',
          type: 'confirm',
          default: false,
        },
      ]);

      if (html) {
        htmlConfig = await this.prompt([
          {
            name: 'title',
            message: '输入title标签',
            type: 'input',
          },
          {
            name: 'keywords',
            message: '输入keywords标签',
            type: 'input',
          },
          {
            name: 'description',
            message: '输入description元数据，用于搜索引擎优化',
            type: 'input',
          },
        ]);
      }
      this.props = { ...this.props, htmlConfig };
    }
    this.props = { name: this.name, app, retry, rem, ...this.props };
  }

  async _singlePage() {
    this._copyFiles([['single/src', 'src']]);
    this._copyTpls([['single/src/index.html', 'src/index.html']]);
    createExampleComponent(this, 'src/components', 'Example', false);
    createSingleExamplePage(this, 'index');
  }

  async _multiPages() {
    const templateFile = 'src/common/template.html';
    this._copyFiles([['multi/src', 'src']]);
    this._copyTpls([[`multi/${templateFile}`, templateFile]]);
    if (this.props.ssr) {
      // 复制node相关文件
      if (this.props.nodeFramework === 'koa') {
        this._copyFiles([['multi/server/index.js', 'server/index.js']]);
      } else {
        this._copyFiles([['multi/server/index.express.js', 'server/index.js']]);
      }
      this._copyTpls([['multi/nodemon.json', 'nodemon.json']]);
      this._copyTpls([['multi/routes.js', 'routes.js']]);
    }
    createExampleComponent(this, 'src/components', 'Example', false);
    createMultiExamplePage(this, 'index');
  }

  _commonFiles() {
    // files
    this._copyFiles([
      ['common/_gitignore', '.gitignore'],
      ['common/.commitlintrc.js', '.commitlintrc.js'],
      ['common/.editorconfig', '.editorconfig'],
      ['common/_eslintrc.js', '.eslintrc.js'],
      ['common/.eslintignore', '.eslintignore'],
      ['common/.gitmessage', '.gitmessage'],
      ['common/.prettierrc', '.prettierrc'],
      ['common/jsconfig.json', 'jsconfig.json'],
      ['common/.stylelintrc.js', '.stylelintrc.js'],
      ['common/.browserslistrc', '.browserslistrc'],
    ]);

    // tpl
    this._copyTpls([
      ['common/_a8k', 'a8k.config.js'],
      ['common/package', 'package.json'],
      ['common/README.md', 'README.md'],
    ]);
    this._copyFiles([['common/assets', 'src/assets']]);
    this._copyFiles([['common/common', 'src/common']]);
  }

  _copyFiles(files = []) {
    files.forEach(([src, dest]) => {
      src = toArray(src);
      dest = toArray(dest);
      this.fs.copy(this.templatePath(...src), this.destinationPath(...dest));
    });
  }

  _copyTpls(files = []) {
    files.forEach(([src, dest]) => {
      src = toArray(src);
      dest = toArray(dest);
      this.fs.copyTpl(this.templatePath(...src), this.destinationPath(...dest), this.props);
    });
  }

  writing() {
    logger.debug(`this.props: ${JSON.stringify(this.props)}`);
    if (this.props.app === 'single') {
      this._singlePage();
    } else {
      this._multiPages();
    }
    this._commonFiles();
  }
}

module.exports = (projectDir, name) => {
  if (!semver.satisfies(process.version, '>= 8.0.0')) {
    console.error(chalk.red('✘ The generator will only work with Node v8.0.0 and up!'));
    process.exit(1);
  }
  return new Promise(resolve => {
    new CreateGenerator({
      name,
      env: { cwd: projectDir },
      resolved: __filename,
    }).run(resolve);
  });
};
