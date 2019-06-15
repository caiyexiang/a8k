import fs from 'fs-extra';
import path from 'path';
import WebpackChain from 'webpack-chain';
import A8k from '..';
import { BUILD_ENV, BUILD_TYPE, ENV_DEV, ENV_PROD } from '../const';
import { IResolveWebpackConfigOptions } from '../interface';

export default class SsrConfig {
  name = 'builtin:config-ssr';
  apply(context: A8k) {
    context.chainWebpack(
      (config: WebpackChain, { type, watch, ssr }: IResolveWebpackConfigOptions) => {
        if (type === BUILD_TYPE.SERVER) {
          const isDevMode = watch;
          config.mode(isDevMode ? ENV_DEV : ENV_PROD);
          config.devtool(false);
          config.target('node');

          const { ssrConfig, publicPath, pagesDir } = context.config;
          let entry: Array<{ key: string; value: string[] }> = [];
          if (ssrConfig.entry) {
            entry = Object.keys(ssrConfig.entry).map(key => {
              let value: any = ssrConfig.entry[key];
              if (!Array.isArray(value)) {
                value = [value];
              }
              return {
                key,
                value,
              };
            });
          } else {
            entry = fs.readdirSync(pagesDir).map((dir: string) => {
              return {
                key: path.basename(dir),
                value: [path.join(pagesDir, dir, 'index.node')],
              };
            });
          }

          entry.forEach(({ key, value }) => {
            config.entry(key).merge(value);
          });

          config.output
            .path(ssrConfig.dist)
            .publicPath(isDevMode ? '' : publicPath)
            .filename('[name].js')
            .libraryTarget('commonjs2');

          const nodeExternals = require('webpack-node-externals');
          config.externals([
            nodeExternals({
              // 注意如果存在src下面其他目录的绝对引用，都需要添加到这里
              whitelist: [/^components/, /^assets/, /^pages/, /^@tencent/, /\.(scss|css)$/],
              // modulesFromFile:true
            }),
          ]);
          config.merge({
            optimization: {
              splitChunks: false,
              minimizer: [],
              runtimeChunk: false,
            },
          });
        }
        if (type === BUILD_TYPE.CLIENT) {
          const { ssrConfig, dist, pagesDir, ssr: supportSSR } = context.config;
          const { mode } = context.internals;
          // 生产模式，或者开发模式下明确声明参数ssr，时需要添加该插件
          const needSsr = (mode === BUILD_ENV.DEVELOPMENT && ssr) || mode === BUILD_ENV.PRODUCTION;
          if (needSsr && supportSSR) {
            const SSRPlugin = require('../webpack/plugins/ssr-plugin');
            SSRPlugin.__expression = "require('a8k/lib/webpack/plugins/ssr-plugin')";
            config.plugin('ssr-plugin').use(SSRPlugin, [
              {
                dist,
                mode,
                pagesDir,
                ssrConfig,
              },
            ]);
          }
        }
      }
    );
  }
}
