import loadConfig from '@a8k/cli-utils/load-config';
import { logger } from '@a8k/common';
import { BUILD_ENV, BUILD_TARGET } from '@a8k/common/lib/constants';
import crypto from 'crypto';
import path from 'path';
import webpack from 'webpack';
import WebpackChain from 'webpack-chain';
import A8k from '..';
import { IResolveWebpackConfigOptions } from '../interface';
export default class DevConfig {
  public name = 'builtin:config-dev';
  public apply(context: A8k) {
    context.chainWebpack((configChain: WebpackChain, options: IResolveWebpackConfigOptions) => {
      const { type, eslint, stylelint } = options;
      // 只有客户端代码 开发模式才需要使用，构建服务器代码不需要
      if (
        (type === BUILD_TARGET.WEB || type === BUILD_TARGET.STORYBOOK) &&
        context.internals.mode === BUILD_ENV.DEVELOPMENT
      ) {
        // 开发模式
        if (eslint) {
          const hash = crypto.createHash('sha256');
          hash.update(
            JSON.stringify(
              loadConfig.loadSync({
                files: ['.eslintrc.js', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json', '.eslintrc'],
                cwd: context.options.baseDir,
                packageKey: 'eslintConfig',
              })
            )
          );

          configChain.module
            .rule('eslint')
            .test(/\.(js|mjs|jsx)$/)
            .pre()
            .include.add(context.resolve('src'))
            .end()
            .use('eslint')
            .loader('eslint-loader')
            .options({
              emitError: false,
              failOnError: false,
              failOnWarning: false,
              quit: true,
              cache: path.resolve(context.config.cacheDirectory, `eslint-loader-${hash.digest('hex')}`),
              formatter: require.resolve('eslint-friendly-formatter'),
              // 要求项目安装eslint，babel-eslint依赖，目的是让vscode 也提示eslint错误
              eslintPath: context.resolve('node_modules', 'eslint'),
            });
        }
        if (stylelint) {
          const stylelintConfig = loadConfig.loadSync({
            files: ['.stylelintrc.js', '.stylelintrc.yaml', '.stylelintrc.yml', '.stylelintrc.json', '.stylelintrc'],
            cwd: context.options.baseDir,
            packageKey: 'stylelintrc',
          });
          if (!stylelintConfig.data || Object.keys(stylelintConfig.data).length < 1) {
            logger.error('确保stylelint配置文件正确有效,可以使用`npx k init lint`自动初始化stylelint');
            process.exit(-1);
          }
          const stylelintFormatter = require('stylelint-formatter-pretty');
          const StyleLintPlugin = require('stylelint-webpack-plugin');
          StyleLintPlugin.__expression = "require('stylelint-webpack-plugin')";
          configChain.plugin('StyleLintPlugin').use(StyleLintPlugin, [{ formatter: stylelintFormatter }]);
        }
        const { HotModuleReplacementPlugin } = webpack;
        (HotModuleReplacementPlugin as any).__expression = "require('webpack').HotModuleReplacementPlugin";
        configChain.plugin('HotModuleReplacementPlugin').use(webpack.HotModuleReplacementPlugin);
      }
    });
  }
}
