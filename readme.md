# @shangxueink/koishi-plugin-puppeteer-without-canvas

[![npm](https://img.shields.io/npm/v/@shangxueink/koishi-plugin-puppeteer-without-canvas?style=flat-square)](https://www.npmjs.com/package/@shangxueink/koishi-plugin-puppeteer-without-canvas)

为 Koishi 提供 Puppeteer 服务，支持本地浏览器和远程浏览器连接。

- 支持本地启动 Chrome/Chromium 浏览器
- 支持连接远程浏览器实例
- 提供 HTML 渲染和截图功能
- 可选的 Canvas 服务集成
- 灵活的渲染配置选项

## 配置说明

<details>
<summary><strong>基本配置</strong></summary>

插件提供了两种工作模式：本地模式和远程模式。

### 本地模式（默认）

在本地模式下，插件会自动启动 Chrome/Chromium 浏览器：

```js
{
  // 本地模式配置
  remote: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // 可选，自动查找
  headless: true, // 无头模式，不显示浏览器界面
  args: ['--no-sandbox', '--disable-gpu'], // 浏览器启动参数
  
  // 功能设置
  enableCanvas: true, // 是否启用 Canvas 服务
  
  // 渲染设置
  render: {
    type: 'png', // 图片类型：'png', 'jpeg', 'webp'
    quality: 80 // 图片质量 (仅适用于 jpeg 和 webp)
  },
  
  // 浏览器视图设置
  defaultViewport: {
    width: 1280,
    height: 768,
    deviceScaleFactor: 2
  }
}
```

### 远程模式

在远程模式下，插件会连接到已经运行的浏览器实例：

```js
{
  // 远程模式配置
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c', // WebSocket URL
  // 或者使用 HTTP URL
  // endpoint: 'http://localhost:14550',
  
  // 其他配置与本地模式相同
  enableCanvas: true,
  render: { type: 'png' },
  defaultViewport: { width: 1280, height: 768, deviceScaleFactor: 2 }
}
```
</details>

<details>
<summary><strong>headers 配置示例</strong></summary>

在远程模式下，可以使用 `headers` 配置项设置连接请求的 HTTP 头信息：

### 基本身份验证

```js
{
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c',
  headers: {
    "Authorization": "Basic dXNlcm5hbWU6cGFzc3dvcmQ=" // username:password 的 Base64 编码
  }
}
```

### API 密钥认证

```js
{
  remote: true,
  endpoint: 'http://localhost:14550',
  headers: {
    "X-API-Key": "your-api-key-here"
  }
}
```

### 自定义用户代理

```js
{
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c',
  headers: {
    "User-Agent": "Koishi-Puppeteer/1.0"
  }
}
```

### 多个头信息

```js
{
  remote: true,
  endpoint: 'ws://localhost:14550/devtools/browser/e5e3466e-b8c6-430f-84f5-a6bca90f516c',
  headers: {
    "Authorization": "Bearer token123",
    "X-Custom-Header": "custom-value",
    "Accept-Language": "zh-CN,zh;q=0.9"
  }
}
```

### 代理配置示例

以下是一个通过 HTTP 代理连接远程浏览器的 `headers` 配置示例。请注意，`headers` 字段本身并不直接配置代理，而是用于在连接时发送自定义的 HTTP 头。代理的配置通常是在启动远程浏览器时通过命令行参数完成的。

```js
{
  remote: true,
  endpoint: 'http://localhost:14550', // HTTP URL
  headers: {
    // 这里的 headers 是针对 Koishi 插件连接远程浏览器时的 HTTP 头，
    // 而不是直接配置代理。
    // 如果远程浏览器本身需要通过代理访问网络，则需要在启动远程浏览器时配置。
    "X-Proxy-Info": "Using External Proxy" 
  }
}
```
</details>

<details>
<summary><strong>启动远程浏览器</strong></summary>

如果您需要启动一个支持远程调试的 Chrome/Chromium 浏览器实例，可以使用以下命令行参数：

```bash
# 启动 Chrome/Chromium 并开启远程调试端口
chrome.exe --remote-debugging-port=14550 --no-sandbox --disable-gpu

# 设置 HTTP 代理
chrome.exe --remote-debugging-port=14550 --proxy-server="http://proxy.example.com:8080"

# 设置 SOCKS5 代理
chrome.exe --remote-debugging-port=14550 --proxy-server="socks5://proxy.example.com:1080"

# 对特定域名使用代理
chrome.exe --remote-debugging-port=14550 --proxy-server="proxy.example.com:8080;direct://*.example.org"
```

#### 注意事项

- 代理设置仅影响浏览器的网络请求，不影响 WebSocket 调试连接。
- 如果代理需要认证，可以使用 `--proxy-auth=username:password` 参数。
- 在生产环境中，建议使用环境变量或配置文件管理代理信息，避免在命令行中暴露敏感信息。
</details>

<details>
<summary><strong>使用示例</strong></summary>

### 渲染 HTML

```js
// 在插件或服务中使用
ctx.puppeteer.render('<div style="color: red">Hello World</div>')
  .then(image => {
    // 处理生成的图片
    console.log(image) // 返回 h.image 对象的字符串表示
  })
```
</details>

<details>
<summary><strong>注意事项</strong></summary>

1. 在 Docker 或 root 用户下运行时，建议添加 `--no-sandbox` 参数。
2. 远程模式需要确保远程浏览器已启动并开启了调试模式。
3. 如果自动查找 Chrome 失败，请手动指定 `executablePath`。
4. 在远程模式下，`headers` 只影响 Koishi 插件连接远程浏览器时的请求头，不影响浏览器本身的行为。
</details>

## 开发指南

<details>
<summary><strong>如何开发/PR</strong></summary>

### 克隆仓库

```bash
yarn clone shangxueink/koishi-plugin-puppeteer-without-canvas
```
这会自动调用 `git clone` 到 `./external/puppeteer-without-canvas` 下

### 修改 Koishi 根工作区的 tsconfig.json

在 `./tsconfig.json` 中添加以下内容：

```json
"koishi-plugin-*": [
  "external/*/src",
  "external/*/packages/core/src",
  "packages/*/src",
  "plugins/*/src"
],
// 添加下面三行
"@shangxueink/koishi-plugin-puppeteer-without-canvas": [
  "external/puppeteer-without-canvas/src",              
],                                                      
```

### 以开发模式启动 🚧

```bash
yarn dev
```

### 编译构建

```bash
yarn build puppeteer-without-canvas
```
</details>

## 许可证

MIT
