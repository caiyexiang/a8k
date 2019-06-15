import getNpmCommand from '@a8k/cli-utils/npm';
import spawn from '@a8k/cli-utils/spawn';
import spinner from '@a8k/cli-utils/spinner';
import createGenerator from './create';

export default class PluginCreateTypescriptProject {
  name = 'builtin:create-ts';
  options: any;
  constructor(options: any) {
    this.options = options;
  }

  apply(context: any) {
    context.registerCreateType(
      'typescript-sample',
      '基于typescript的简单项目',
      async ({ projectDir }) => {
        await createGenerator(projectDir);
        await context.hooks.invokePromise('afterCreate', context);
        spinner.succeed('File Generate Done');

        const npmCmd = getNpmCommand();
        const deps = [
          '@a8k/changelog',
          '@commitlint/cli',
          'commitizen',
          'commitlint-config-cz',
          'cz-customizable',
          'husky',
          'lint-staged',
          'prettier',
          'tslint',
          'jest',
          '@types/jest',
          '@types/node',
          'typescript',
        ];

        await spawn(npmCmd, ['i', '-D', ...deps], { cwd: projectDir });
        spinner.succeed('安装依赖完毕');
        await context.hooks.invokePromise(context);
        spinner.succeed('项目创建完毕');
      }
    );
  }
}
