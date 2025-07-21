import subprocess
import time
import os
import sys
import signal
import atexit
import webbrowser
import json
import uuid
from urllib.request import urlopen
from urllib.error import URLError

# Chrome可执行文件路径
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
# 远程调试端口
DEBUG_PORT = 14550
# 用户数据目录
USER_DATA_DIR = os.path.join(os.path.expanduser("~"), "chrome-remote-profile")

def start_chrome():
    """启动Chrome浏览器，开启远程调试模式"""
    print(f"启动Chrome，远程调试端口: {DEBUG_PORT}")
    
    # 确保用户数据目录存在
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    
    # 构建Chrome启动命令
    cmd = [
        CHROME_PATH,
        f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={USER_DATA_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized"
    ]
    
    # 启动Chrome进程
    process = subprocess.Popen(cmd)
    
    # 注册退出处理函数，确保脚本退出时关闭Chrome
    def cleanup():
        if process.poll() is None:
            print("关闭Chrome...")
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
    
    atexit.register(cleanup)
    
    # 等待Chrome启动
    print("等待Chrome启动...")
    print("请等待启动后展示浏览器远程地址...")
    time.sleep(2)
    
    return process

def get_websocket_endpoint():
    """获取Chrome远程调试WebSocket端点"""
    try:
        # 尝试连接到Chrome远程调试API
        response = urlopen(f"http://localhost:{DEBUG_PORT}/json/version")
        data = json.loads(response.read().decode())
        websocket_url = data.get("webSocketDebuggerUrl")
        
        if websocket_url:
            print(f"WebSocket调试端点: {websocket_url}")
            return websocket_url
        else:
            print("无法获取WebSocket调试端点")
            return None
    except URLError as e:
        print(f"连接Chrome远程调试API失败: {e}")
        return None

def generate_endpoint_options(websocket_endpoint):
    """生成不同的端点选项"""
    options = []
    
    # 1. 标准WebSocket URL (带有 /devtools/browser/)
    options.append(websocket_endpoint)
    
    # 2. HTTP URL
    options.append(f"http://localhost:{DEBUG_PORT}")
    
    # 3. 不包含 devtools/browser 的 WebSocket URL
    random_id = str(uuid.uuid4())[:8]
    options.append(f"ws://localhost:{DEBUG_PORT}/debug/{random_id}")
    
    return options

def display_endpoint_options(options):
    """显示端点选项并让用户选择"""
    print("\n=== 请选择连接方式 ===")
    print("1. 标准 WebSocket URL (带有 /devtools/browser/)")
    print(f"   {options[0]}")
    print("2. HTTP URL")
    print(f"   {options[1]}")
    print("3. 不包含 devtools/browser 的 WebSocket URL")
    print(f"   {options[2]}")
    print("4. 启用故障模拟 (使用HTTP端点，每30秒断开连接5秒)")
    
    while True:
        try:
            choice = int(input("\n请输入选项序号 (1-4): "))
            if 1 <= choice <= 4:
                return choice - 1
            else:
                print("无效的选择，请输入 1-4 之间的数字")
        except ValueError:
            print("请输入有效的数字")

def simulate_failure_with_http(chrome_process):
    """使用HTTP端点模拟故障：每30秒断开连接5秒"""
    print("\n=== 故障模拟模式已启动 (HTTP端点) ===")
    print("每30秒将断开连接5秒")
    
    # 使用固定的HTTP端点
    http_endpoint = f"http://localhost:{DEBUG_PORT}"
    
    try:
        cycle_count = 0
        while True:
            cycle_count += 1
            # 正常运行30秒
            print(f"\n[故障模拟] 周期 {cycle_count}: 正常运行30秒...")
            for i in range(30):
                if chrome_process.poll() is not None:
                    print("Chrome进程已终止，退出故障模拟")
                    return chrome_process
                time.sleep(1)
                
            print(f"[故障模拟] 周期 {cycle_count}: 断开连接5秒...")
            # 终止Chrome进程
            chrome_process.terminate()
            try:
                chrome_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print("Chrome进程未能正常终止，强制结束")
                chrome_process.kill()
                chrome_process.wait(timeout=5)
            
            # 等待5秒
            time.sleep(5)
            
            # 重新启动Chrome进程
            print(f"[故障模拟] 周期 {cycle_count}: 恢复连接...")
            try:
                # 保存Chrome启动参数
                cmd = [
                    CHROME_PATH,
                    f"--remote-debugging-port={DEBUG_PORT}",
                    f"--user-data-dir={USER_DATA_DIR}",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--start-maximized"
                ]
                chrome_process = subprocess.Popen(cmd)
            except Exception as e:
                print(f"重启Chrome失败: {e}")
                return chrome_process
            
            # 等待Chrome重新启动
            print("等待Chrome重新启动...")
            time.sleep(3)
            
            # 尝试访问HTTP端点，确认Chrome已启动
            try:
                response = urlopen(http_endpoint + "/json/version")
                if response.getcode() == 200:
                    print(f"Chrome已重新启动，HTTP端点可访问: {http_endpoint}")
                else:
                    print(f"警告: HTTP端点返回状态码 {response.getcode()}")
            except Exception as e:
                print(f"警告: 无法访问HTTP端点: {e}")
                
    except KeyboardInterrupt:
        print("\n接收到中断信号，正在关闭...")
        
    return chrome_process

def main():
    """主函数"""
    print("启动Chrome远程调试服务...")
    
    # 检查Chrome是否存在
    if not os.path.exists(CHROME_PATH):
        print(f"错误: Chrome可执行文件未找到: {CHROME_PATH}")
        sys.exit(1)
    
    # 启动Chrome
    chrome_process = start_chrome()
    
    # 等待Chrome完全启动
    time.sleep(3)
    
    # 获取WebSocket端点
    websocket_endpoint = get_websocket_endpoint()
    
    if websocket_endpoint:
        # 生成不同的端点选项
        endpoint_options = generate_endpoint_options(websocket_endpoint)
        
        # 显示选项并获取用户选择
        selected_index = display_endpoint_options(endpoint_options)
        
        # 故障模拟模式
        if selected_index == 3:
            # 使用HTTP URL
            selected_endpoint = endpoint_options[1]  # HTTP URL
            print("\n=== 已选择故障模拟模式 ===")
            print(f"远程浏览器端点: {selected_endpoint}")
            
            print("\n在Koishi配置中使用:")
            print(f"""{{
  "remote": true,
  "endpoint": "{selected_endpoint}",
  "enableReconnect": true,
  "reconnectInterval": 1000
}}""")
            
            print("\n按Ctrl+C停止服务...")
            chrome_process = simulate_failure_with_http(chrome_process)
        else:
            # 正常模式
            selected_endpoint = endpoint_options[selected_index]
            
            print("\n=== 已选择的连接信息 ===")
            print(f"远程浏览器端点: {selected_endpoint}")
            
            print("\n在Koishi配置中使用:")
            print(f"""{{
  "remote": true,
  "endpoint": "{selected_endpoint}"
}}""")
            
            # 如果选择了非标准选项，添加提示
            if selected_index > 0:
                print("\n注意: 你选择了非标准连接方式，这可能不会正常工作。")
            
            print("\n按Ctrl+C停止服务...")
            
            try:
                # 保持脚本运行
                while chrome_process.poll() is None:
                    time.sleep(1)
            except KeyboardInterrupt:
                print("\n接收到中断信号，正在关闭...")
    else:
        print("无法获取连接信息，请检查Chrome是否正常启动")
        sys.exit(1)
    
    print("服务已停止")

if __name__ == "__main__":
    main()