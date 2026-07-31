// 在 release 模式下将 Windows 子系统设为 windows，隐藏控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wuwa_gacha_tool_lib::run();
}
