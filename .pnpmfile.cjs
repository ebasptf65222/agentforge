// .pnpmfile.cjs - pnpm 项目级安装钩子
// 解决国内网络下依赖安装卡住的问题：
//
// 1. ffmpeg-static 的 postinstall 会从 GitHub Releases 下载 ~80MB 的 ffmpeg 二进制，
//    国内直连 GitHub 极慢会导致 pnpm install 长时间卡在最后几个包。
//    此钩子将其下载源改写为 npmmirror 国内镜像。
//
// 2. Electron 的二进制下载镜像配置在 .npmrc 的 electron_mirror 中。

const FFMPEG_MIRROR = 'https://registry.npmmirror.com/-/binary/ffmpeg-static'

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'ffmpeg-static' && pkg.scripts && pkg.scripts.postinstall) {
        // 注入镜像环境变量后执行原安装脚本（跨平台写法，兼容 cmd/bash）
        pkg.scripts.postinstall =
          `node -e "process.env.FFMPEG_BINARIES_URL='${FFMPEG_MIRROR}'; require('./install.js')"`
      }
      return pkg
    },
  },
}
