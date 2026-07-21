# 像素城市求生

> 二维像素末日生存游戏 · 基于 Electron

---

## 🚀 协作者入门（从零开始，跟着做就行）

### 第 0 步：装好必要软件（只做一次）

1. **安装 Git**：去 https://git-scm.com/download/win 下载安装，一路默认下一步。安装完打开 PowerShell，输入 `git --version`，能看到版本号就 OK。
2. **安装 Node.js**：去 https://nodejs.org/ 下载 **LTS 版**，一路默认安装。装完在 PowerShell 输入 `node -v` 和 `npm -v`，都能看到版本号就 OK。
3. **配置你的 git 身份**（只做一次，每次提交要用的名字邮箱）：

   ```powershell
   git config --global user.name  "你的名字"
   git config --global user.email "你的邮箱@example.com"
   ```

4. **配置 GitHub 访问**（国内连 github.com 经常超时，建议开代理后给 git 配代理，端口换成你代理软件的端口）：

   ```powershell
   git config --global http.proxy  http://127.0.0.1:7890
   git config --global https.proxy http://127.0.0.1:7890
   ```

   > 不用代理时取消：`git config --global --unset http.proxy` / `--unset https.proxy`

### 第 1 步：克隆仓库到本地

```powershell
cd 你想放代码的目录      # 比如 cd D:\code
git clone https://github.com/WilllWANG-cmd/git--.git
cd git--                 # 进入项目文件夹
```

> 如果提示 `Failed to connect to github.com:443`，就是网络问题，开代理 / 配 git 代理（见第 0 步）。

### 第 2 步：安装依赖（只做一次，或 package.json 变化后重做）

```powershell
npm install
```

这一步会下载 Electron 和 electron-builder，大约 200MB，需要几分钟。**这一步生成的 `node_modules/` 文件夹不会进 git**（已被 `.gitignore` 排除），别手动删它，删了游戏就跑不起来，重跑 `npm install` 即可恢复。

### 第 3 步：运行游戏（开发模式）

```powershell
npm start
```

会弹出一个 Electron 窗口，里面就是游戏。**改完代码后关掉窗口重新 `npm start` 就能看到效果**。

### 第 4 步：改代码

用任意编辑器（推荐 [Cursor](https://cursor.com) 或 [VS Code](https://code.visualstudio.com/)）打开项目文件夹，改 `src/game.js`、`src/index.html`、`src/style.css`、`party.js` 等。游戏核心逻辑在 `src/game.js`。

### 第 5 步：提交并推送你的修改

```powershell
# 看看改了哪些文件
git status

# 把所有改动加入暂存
git add .

# 提交（写清楚你改了啥）
git commit -m "feat: 加了新怪物 / 修复了 xx bug"

# 推送到远端
git push
```

> 💡 **提交信息写法建议**：
> - `feat: xxx` —— 新功能
> - `fix: xxx` —— 修 bug
> - `docs: xxx` —— 改文档
> - `refactor: xxx` —— 重构（不改功能）

### 第 6 步：拉取别人的最新代码（每次开始干活前先做）

```powershell
git pull
```

这样能把协作者推上去的最新代码同步到你本地，避免冲突。

---

## 🤝 两人协作的推荐流程

为了避免两个人改同一个文件打架，推荐用**分支 + Pull Request**：

```powershell
# 开个新分支干你的活
git checkout -b feat/add-monster

# 改代码、测试、提交...
git add .
git commit -m "feat: 加新怪物"
git push -u origin feat/add-monster

# 然后上 GitHub 网页，会提示你创建 Pull Request，点一下，让另一个人 review 后合并
```

合并完回到主干：

```powershell
git checkout main
git pull
```

> 如果觉得分支太复杂，两个人也可以直接都往 `main` 推，但**每次开始干活前一定先 `git pull`**，不然容易冲突。

---

## 📦 打包发布新版本（给玩家下载的 .exe）

打包由仓库 owner 负责，协作者一般不用做。流程：

```powershell
npm run dist          # 产出 dist/像素城市求生.exe（便携版）
# 或
npm run dist-installer   # 产出 NSIS 安装包
```

然后上 GitHub 仓库页面 → **Releases** → **Draft a new release**：
1. 填版本号（如 `v1.1.0`）
2. 把 `dist/像素城市求生.exe` 拖到附件区
3. 写更新说明
4. 点 **Publish release**

玩家就能在仓库的 Releases 区下载到 `.exe` 了。**`.exe` 不进 git 仓库，不占仓库空间**。

---

## ❓ 常见问题

**Q：`git push` 报 `Failed to connect to github.com:443`？**
A：网络问题，开代理 + 配 git 代理（见第 0 步第 4 条）。

**Q：`git push` 报 `non-fast-forward` / 推不上去？**
A：远端有别人推的新代码，先 `git pull`，再 `git push`。

**Q：`npm start` 报 `electron not found`？**
A：没装依赖，先 `npm install`。

**Q：改了代码看不到效果？**
A：关掉游戏窗口，重新 `npm start`。

**Q：`node_modules` 被我不小心删了？**
A：重跑 `npm install` 就行。

---

## 📜 License

MIT
