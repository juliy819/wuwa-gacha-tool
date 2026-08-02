use crate::gacha::fetcher::GachaParams;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    webview::NewWindowResponse, AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

const CLOUD_GACHA_WINDOW_PREFIX: &str = "cloud-gacha-";
const CLOUD_GACHA_URL: &str = "https://mc.kurogames.com/cloud/index.html#/";
const GACHA_HOST: &str = "aki-gm-resources.aki-game.com";
const GACHA_PATH: &str = "/aki/gacha/index.html";
static CLOUD_GACHA_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

const CLOUD_CAPTURE_SCRIPT: &str = r#"
(() => {
  if (window.location.origin !== 'https://mc.kurogames.com' || window !== window.top) return;

  const TARGET_SELECTOR = 'iframe[src*="aki-gm-resources.aki-game.com/aki/gacha/index.html"]';
  let toolClicked = false;
  let loginDetected = false;
  let loginFallbackShown = false;
  const loginWaitStartedAt = Date.now();
  let recordClickAttempts = 0;
  let lastRecordClickAt = Number.NEGATIVE_INFINITY;
  let captureSent = false;
  let scheduled = false;
  let failureTimer = 0;

  function mountStatus() {
    if (!document.body || document.getElementById('wuwa-gacha-helper')) return;
    const helper = document.createElement('div');
    helper.id = 'wuwa-gacha-helper';
    helper.style.cssText = [
      'position:fixed', 'top:18px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'max-width:min(620px,calc(100vw - 32px))',
      'padding:10px 14px', 'border:1px solid rgba(255,255,255,.18)',
      'border-radius:6px', 'background:rgba(24,24,24,.94)', 'color:#f2f2f2',
      'font:13px/1.5 system-ui,sans-serif', 'box-shadow:0 8px 28px rgba(0,0,0,.35)',
      'pointer-events:none', 'text-align:center'
    ].join(';');
    helper.textContent = '请登录云鸣潮；登录后将自动打开“工具 → 唤取记录”并提取链接。';
    document.body.appendChild(helper);
  }

  function setStatus(message, tone) {
    mountStatus();
    const helper = document.getElementById('wuwa-gacha-helper');
    if (!helper) return;
    helper.textContent = message;
    helper.style.borderColor = tone === 'error'
      ? 'rgba(217,154,154,.55)'
      : tone === 'success'
        ? 'rgba(139,190,157,.55)'
        : 'rgba(255,255,255,.18)';
  }

  function reportCaptured(url) {
    if (captureSent) return;
    captureSent = true;
    setStatus('已提取抽卡链接，正在返回 Wuwa Gacha Tool…', 'success');
    window.location.href = 'wuwa-gacha://captured?url=' + encodeURIComponent(url);
  }

  function findTargetUrl() {
    const frame = document.querySelector(TARGET_SELECTOR);
    if (!frame) return '';
    const src = frame.src || frame.getAttribute('src') || '';
    return src.startsWith('https://' + 'aki-gm-resources.aki-game.com/aki/gacha/index.html') ? src : '';
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }

  function findClickable(label) {
    if (label === '唤取记录') {
      const wrappers = Array.from(document.querySelectorAll('.tools-inner .tool-card-wrapper'));
      const matchingWrapper = wrappers.find((wrapper) => {
        const text = (wrapper.textContent || '').replace(/\s+/g, '');
        return text.includes('唤取记录')
          || wrapper.querySelector('[aria-label="唤取记录"]')
          || wrapper.querySelector('[src*="huanqujilu"], [href*="huanqujilu"]');
      });
      const matchingCard = matchingWrapper?.querySelector('.tool-card');
      if (isVisible(matchingCard)) return matchingCard;

      // The current official desktop page contains exactly two cards and keeps
      // gacha records first. Do not guess by position if that structure changes.
      if (wrappers.length === 2) {
        const firstToolCard = wrappers[0].querySelector('.tool-card');
        if (isVisible(firstToolCard)) return firstToolCard;
      }
    }

    const normalizedLabel = label.replace(/\s+/g, '');
    const hasLabel = (element) => (element.textContent || '').replace(/\s+/g, '') === normalizedLabel;
    const direct = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .find((element) => isVisible(element) && hasLabel(element));
    if (direct) return direct;

    const ariaLabel = Array.from(document.querySelectorAll('[aria-label]'))
      .find((element) => isVisible(element) && element.getAttribute('aria-label') === label);
    if (ariaLabel) {
      const card = ariaLabel.closest('.tool-card');
      const wrapperCard = ariaLabel.closest('.tool-card-wrapper')?.querySelector('.tool-card');
      return card || wrapperCard || ariaLabel.closest('button, a, [role="button"]') || ariaLabel;
    }

    const leaf = Array.from(document.querySelectorAll('span, div, p'))
      .find((element) => isVisible(element) && element.children.length === 0 && hasLabel(element));
    return leaf
      ? (leaf.closest('.tool-card-wrapper, .tool-card, button, a, [role="button"], [class*="item"], [class*="menu"]') || leaf)
      : null;
  }

  function isLoggedIn() {
    return /通行证\s*ID\s*[:：]\s*\d+/i.test(document.body?.innerText || '');
  }

  function beginManualFallback(message) {
    window.clearTimeout(failureTimer);
    setStatus(message + ' 请手动打开“工具 → 唤取记录”，程序仍会自动提取链接。', 'error');
  }

  function inspect() {
    scheduled = false;
    const targetUrl = findTargetUrl();
    if (targetUrl) {
      reportCaptured(targetUrl);
      return;
    }

    if (!toolClicked && !isLoggedIn()) {
      if (!loginFallbackShown && Date.now() - loginWaitStartedAt >= 20000) {
        loginFallbackShown = true;
        beginManualFallback('未能自动确认登录状态。若你已完成登录，');
      } else if (!loginFallbackShown) {
        setStatus('请先登录云鸣潮；检测到登录成功后，程序会自动打开“工具 → 唤取记录”。');
      }
      return;
    }

    if (!loginDetected) {
      loginDetected = true;
      setStatus('已检测到登录状态，正在准备自动打开“工具 → 唤取记录”…');
    }

    if (!toolClicked) {
      const tool = findClickable('工具');
      if (!tool) return;
      toolClicked = true;
      setStatus('正在自动操作，请勿手动点击：正在打开“工具”…');
      tool.click();
      failureTimer = window.setTimeout(() => {
        if (recordClickAttempts === 0 && !captureSent) beginManualFallback('未能自动找到“唤取记录”。');
      }, 10000);
      scheduleInspect();
      return;
    }

    const now = Date.now();
    if (recordClickAttempts >= 3 || now - lastRecordClickAt < 4000) return;

    const record = findClickable('唤取记录');
    if (!record) return;
    recordClickAttempts += 1;
    lastRecordClickAt = now;
    window.clearTimeout(failureTimer);
    setStatus('正在自动操作，请勿手动点击：正在打开“唤取记录”…');
    record.click();
    failureTimer = window.setTimeout(() => {
      if (!captureSent && recordClickAttempts >= 3) beginManualFallback('唤取记录页面未能自动加载。');
    }, 15000);
    scheduleInspect();
  }

  function scheduleInspect() {
    if (scheduled || captureSent) return;
    scheduled = true;
    window.setTimeout(inspect, 250);
  }

  function start() {
    mountStatus();
    new MutationObserver(scheduleInspect).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'class']
    });
    window.setInterval(scheduleInspect, 1000);
    scheduleInspect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
"#;

#[derive(Clone, Serialize)]
struct CloudGachaLink {
    url: String,
    player_id: String,
}

fn is_trusted_cloud_navigation(url: &Url) -> bool {
    if url.scheme() == "about" {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }

    let Some(host) = url.host_str() else {
        return false;
    };

    [
        "kurogames.com",
        "kurogame.com",
        "kurogame.xyz",
        "aki-game.com",
        "aki-game2.com",
    ]
    .iter()
    .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn validate_captured_url(raw_url: &str) -> Result<CloudGachaLink, String> {
    let parsed = Url::parse(raw_url).map_err(|e| format!("抽卡链接格式无效: {e}"))?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some(GACHA_HOST)
        || parsed.path() != GACHA_PATH
    {
        return Err("捕获到的页面不是官方抽卡记录地址".to_string());
    }

    let params = GachaParams::from_url(raw_url)?;
    if params.resources_id.is_empty() || params.svr_id.is_empty() {
        return Err("捕获到的抽卡链接缺少卡池或服务器参数".to_string());
    }

    Ok(CloudGachaLink {
        url: raw_url.to_string(),
        player_id: params.player_id,
    })
}

fn is_official_gacha_page(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some(GACHA_HOST) && url.path() == GACHA_PATH
}

fn emit_captured_url(app: &AppHandle, raw_url: &str) {
    match validate_captured_url(raw_url) {
        Ok(payload) => {
            let _ = app.emit_to("main", "cloud-gacha-link", payload);
        }
        Err(message) => {
            let _ = app.emit_to("main", "cloud-gacha-error", message);
        }
    }
}

fn build_cloud_gacha_window(app: AppHandle) -> Result<(), String> {
    if let Some((_, existing)) = app
        .webview_windows()
        .into_iter()
        .find(|(label, _)| label.starts_with(CLOUD_GACHA_WINDOW_PREFIX))
    {
        let _ = existing.unminimize();
        if existing.set_focus().is_ok() {
            return Ok(());
        }
    }

    let cloud_url = Url::parse(CLOUD_GACHA_URL).map_err(|e| e.to_string())?;
    let sequence = CLOUD_GACHA_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let window_label = format!("{CLOUD_GACHA_WINDOW_PREFIX}{sequence}");
    let navigation_app = app.clone();
    WebviewWindowBuilder::new(&app, window_label, WebviewUrl::External(cloud_url))
        .title("云鸣潮 - 获取抽卡链接")
        .inner_size(1180.0, 820.0)
        .min_inner_size(900.0, 640.0)
        .center()
        .initialization_script(CLOUD_CAPTURE_SCRIPT)
        .on_navigation(move |url| {
            if url.scheme() == "wuwa-gacha" {
                if url.host_str() == Some("captured") {
                    let captured = url
                        .query_pairs()
                        .find(|(key, _)| key == "url")
                        .map(|(_, value)| value.into_owned());

                    if let Some(raw_url) = captured {
                        emit_captured_url(&navigation_app, &raw_url);
                    } else {
                        let _ = navigation_app.emit_to(
                            "main",
                            "cloud-gacha-error",
                            "未收到抽卡链接".to_string(),
                        );
                    }
                }
                return false;
            }

            if is_official_gacha_page(url) {
                emit_captured_url(&navigation_app, url.as_str());
                return false;
            }

            is_trusted_cloud_navigation(url)
        })
        .on_new_window({
            let new_window_app = app.clone();
            move |url, _| {
                if is_official_gacha_page(&url) {
                    emit_captured_url(&new_window_app, url.as_str());
                    return NewWindowResponse::Deny;
                }

                if is_trusted_cloud_navigation(&url) {
                    NewWindowResponse::Allow
                } else {
                    NewWindowResponse::Deny
                }
            }
        })
        .build()
        .map_err(|e| format!("无法打开云鸣潮窗口: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn open_cloud_gacha_window(app: AppHandle) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let main_thread_app = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(build_cloud_gacha_window(main_thread_app));
    })
    .map_err(|e| format!("无法调度云鸣潮窗口创建: {e}"))?;

    receiver
        .await
        .map_err(|_| "云鸣潮窗口创建任务意外终止".to_string())?
}

fn close_cloud_gacha_windows(app: &AppHandle) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label.starts_with(CLOUD_GACHA_WINDOW_PREFIX) {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn close_cloud_gacha_window(app: AppHandle) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let main_thread_app = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(close_cloud_gacha_windows(&main_thread_app));
    })
    .map_err(|e| format!("无法调度云鸣潮窗口关闭: {e}"))?;

    receiver
        .await
        .map_err(|_| "云鸣潮窗口关闭任务意外终止".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_official_cloud_gacha_link() {
        let url = "https://aki-gm-resources.aki-game.com/aki/gacha/index.html?svr_id=server&player_id=106485288&record_id=token&resources_id=pool&lang=zh-Hans#/record?svr_id=server&player_id=106485288&record_id=token&resources_id=pool&lang=zh-Hans";
        let payload = validate_captured_url(url).unwrap();
        assert_eq!(payload.player_id, "106485288");
    }

    #[test]
    fn rejects_lookalike_gacha_host() {
        let url = "https://aki-gm-resources.aki-game.com.example.com/aki/gacha/index.html?svr_id=server&player_id=106485288&record_id=token&resources_id=pool";
        assert!(validate_captured_url(url).is_err());
    }

    #[test]
    fn rejects_missing_cloud_parameters() {
        let url = "https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?player_id=106485288&record_id=token";
        assert!(validate_captured_url(url).is_err());
    }
}
