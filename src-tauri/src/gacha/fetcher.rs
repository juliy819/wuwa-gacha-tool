use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use url::{form_urlencoded, Url};

/// 抽卡 API 基础 URL
const CN_API_URL: &str = "https://gmserver-api.aki-game2.com/gacha/record/query";
const GLOBAL_API_URL: &str = "https://gmserver-api.aki-game2.net/gacha/record/query";

/// 卡池类型映射：API 发送的 type → 显示名称
///
/// API 返回的 cardPoolType 是中文名称，对应关系：
/// 1 → 角色精准调谐(UP角色)   2 → 武器精准调谐(UP武器)
/// 3 → 角色常驻调谐           4 → 武器常驻调谐
/// 5 → 新手调谐               6 → 新手自选调谐
/// 7 → 新手自选调谐（感恩定向）  8 → 角色新旅调谐
/// 9 → 武器新旅调谐            10 → 角色联动调谐
/// 11 → 武器联动调谐           12 → 角色忆旅调谐
/// 13 → 武器忆旅调谐
pub const POOL_TYPES: [(&str, &str); 13] = [
    ("角色精准调谐", "1"),
    ("武器精准调谐", "2"),
    ("角色常驻调谐", "3"),
    ("武器常驻调谐", "4"),
    ("新手调谐", "5"),
    ("新手自选调谐", "6"),
    ("新手自选调谐（感恩定向调谐）", "7"),
    ("角色新旅调谐", "8"),
    ("武器新旅调谐", "9"),
    ("角色联动调谐", "10"),
    ("武器联动调谐", "11"),
    ("角色忆旅调谐", "12"),
    ("武器忆旅调谐", "13"),
];

/// pool type ID → 显示名称（用户友好的名称）
pub fn get_display_pool_name(pool_type: &str) -> &str {
    match pool_type {
        "1" => "角色活动唤取",
        "2" => "武器活动唤取",
        "3" => "角色常驻唤取",
        "4" => "武器常驻唤取",
        "5" => "新手唤取",
        "6" => "新手自选唤取",
        "7" => "新手自选唤取",
        "8" => "角色新旅唤取",
        "9" => "武器新旅唤取",
        "10" => "角色联动唤取",
        "11" => "武器联动唤取",
        "12" => "角色忆旅唤取",
        "13" => "武器忆旅唤取",
        _ => "未知卡池",
    }
}

/// pool type 中文名 → 大类分组
pub fn get_pool_group(pool_type: &str) -> &str {
    match pool_type {
        "1" | "8" | "10" => "UP角色池",
        "2" | "9" | "11" => "UP武器池",
        "3" => "常驻角色池",
        "4" => "常驻武器池",
        "5" | "6" | "7" => "新手池",
        "12" => "忆旅角色池",
        "13" => "忆旅武器池",
        _ => "其他",
    }
}

/// pool type 中文名 → 是否为限定角色池（有 50/50 保底）
pub fn is_limited_char_pool(pool_type: &str) -> bool {
    matches!(pool_type, "1" | "8" | "10" | "12")
}

pub fn hard_pity_for_pool(pool_type: &str) -> i32 {
    if pool_type == "5" {
        50
    } else {
        80
    }
}

/// pool type ID → API 中文名（用于导出 JSON）
pub fn pool_type_to_api_name(pool_type: &str) -> &str {
    POOL_TYPES
        .iter()
        .find(|(_, t)| *t == pool_type)
        .map(|(n, _)| *n)
        .unwrap_or("")
}

/// 从 URL 解析出的参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GachaParams {
    pub player_id: String,
    pub record_id: String,
    pub resources_id: String,
    pub gacha_type: String,
    pub svr_id: String,
    pub lang: String,
}

/// API 请求体
#[derive(Debug, Serialize)]
struct ApiRequest<'a> {
    #[serde(rename = "playerId")]
    player_id: &'a str,
    #[serde(rename = "recordId")]
    record_id: &'a str,
    #[serde(rename = "cardPoolId")]
    card_pool_id: &'a str,
    #[serde(rename = "serverId")]
    server_id: &'a str,
    #[serde(rename = "languageCode")]
    language_code: &'a str,
    #[serde(rename = "cardPoolType")]
    card_pool_type: &'a str,
}

/// API 响应结构
#[derive(Debug, Deserialize)]
struct ApiResponse {
    code: i32,
    #[serde(default)]
    data: Vec<ApiCardInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiCardInfo {
    /// 中文卡池名（如 "角色精准调谐"）
    #[serde(rename = "cardPoolType")]
    pub card_pool_type: String,
    #[serde(rename = "resourceId")]
    pub resource_id: i64,
    #[serde(rename = "qualityLevel")]
    pub quality_level: i32,
    /// 中文资源类型（"角色" 或 "武器"）
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    pub name: String,
    pub count: i32,
    pub time: String,
}

impl GachaParams {
    pub fn from_url(url: &str) -> Result<Self, String> {
        let parsed = Url::parse(url).map_err(|e| format!("抽卡链接格式无效: {e}"))?;
        let mut params = HashMap::new();

        for (key, value) in parsed.query_pairs() {
            params.insert(key.into_owned(), value.into_owned());
        }

        // PC 日志链接通常把参数放在 #/record? 后；云鸣潮链接会在
        // 顶层 query 和 hash 中各带一份。hash 参数优先，兼容两种格式。
        if let Some(fragment_query) = parsed
            .fragment()
            .and_then(|fragment| fragment.split_once('?'))
        {
            for (key, value) in form_urlencoded::parse(fragment_query.1.as_bytes()) {
                params.insert(key.into_owned(), value.into_owned());
            }
        }

        let take = |key: &str| params.get(key).cloned().unwrap_or_default();
        let player_id = take("player_id");
        let record_id = take("record_id");
        let resources_id = take("resources_id");
        let gacha_type = take("gacha_type");
        let svr_id = take("svr_id");
        let lang = take("lang");

        if player_id.is_empty() || record_id.is_empty() {
            return Err("URL 参数不完整".to_string());
        }

        Ok(Self {
            player_id,
            record_id,
            resources_id,
            gacha_type,
            svr_id,
            lang,
        })
    }

    pub fn get_api_url(&self) -> &str {
        if self.player_id.starts_with('1') {
            CN_API_URL
        } else {
            GLOBAL_API_URL
        }
    }
}

pub async fn fetch_pool_data(
    client: &reqwest::Client,
    params: &GachaParams,
    card_pool_type: &str,
) -> Result<Vec<ApiCardInfo>, String> {
    let api_url = params.get_api_url();

    let request_body = ApiRequest {
        player_id: &params.player_id,
        record_id: &params.record_id,
        card_pool_id: &params.resources_id,
        server_id: &params.svr_id,
        language_code: &params.lang,
        card_pool_type,
    };

    let response = client
        .post(api_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if status != 200 {
        return Err(format!("HTTP {}: {}", status, body_text));
    }

    let api_response: ApiResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("解析响应失败: {} | 原始: {}", e, body_text))?;

    if api_response.code != 0 {
        return Err(format!("API 错误码: {}", api_response.code));
    }

    Ok(api_response.data)
}

/// 构建卡池类型索引（中文名 → ID）
pub fn build_pool_name_to_id() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for (name, id) in POOL_TYPES.iter() {
        map.insert(name.to_string(), id.to_string());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_url() {
        let url = "https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=76402e5b20be2c39f095a152090afddc&player_id=106485288&lang=zh-Hans&gacha_id=100074&gacha_type=1&svr_area=cn&record_id=acdf99a1891e329555d37279a48f68ba&resources_id=c9fbcd24b02d54c175875b81513cfacc&platform=PC";
        let params = GachaParams::from_url(url).unwrap();
        assert_eq!(params.player_id, "106485288");
        assert_eq!(params.record_id, "acdf99a1891e329555d37279a48f68ba");
        assert_eq!(params.resources_id, "c9fbcd24b02d54c175875b81513cfacc");
    }

    #[test]
    fn parses_pc_hash_only_url() {
        let url = "https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=cn-server&player_id=123456789&record_id=pc-token&resources_id=pool-id&gacha_type=1&lang=zh-Hans";
        let params = GachaParams::from_url(url).unwrap();

        assert_eq!(params.player_id, "123456789");
        assert_eq!(params.record_id, "pc-token");
        assert_eq!(params.resources_id, "pool-id");
        assert_eq!(params.svr_id, "cn-server");
    }

    #[test]
    fn parses_cloud_query_and_hash_url_with_hash_precedence() {
        let url = "https://aki-gm-resources.aki-game.com/aki/gacha/index.html?player_id=old&record_id=old-token&resources_id=old-pool&svr_id=old-server&lang=zh-Hans#/record?player_id=106485288&record_id=cloud-token&resources_id=cloud-pool&svr_id=cloud-server&lang=zh-Hans";
        let params = GachaParams::from_url(url).unwrap();

        assert_eq!(params.player_id, "106485288");
        assert_eq!(params.record_id, "cloud-token");
        assert_eq!(params.resources_id, "cloud-pool");
        assert_eq!(params.svr_id, "cloud-server");
    }

    #[test]
    fn decodes_percent_encoded_parameters() {
        let url = "https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?player_id=123456789&record_id=token%2Bvalue&lang=zh%2DHans";
        let params = GachaParams::from_url(url).unwrap();

        assert_eq!(params.record_id, "token+value");
        assert_eq!(params.lang, "zh-Hans");
    }

    #[test]
    fn test_pool_name_mapping() {
        let map = build_pool_name_to_id();
        assert_eq!(map.get("角色精准调谐").unwrap(), "1");
        assert_eq!(map.get("武器精准调谐").unwrap(), "2");
        assert_eq!(map.get("角色常驻调谐").unwrap(), "3");
    }

    #[test]
    fn test_pool_group() {
        assert_eq!(get_pool_group("1"), "UP角色池");
        assert_eq!(get_pool_group("8"), "UP角色池");
        assert_eq!(get_pool_group("10"), "UP角色池");
        assert_eq!(get_pool_group("2"), "UP武器池");
        assert_eq!(get_pool_group("3"), "常驻角色池");
        assert!(is_limited_char_pool("1"));
        assert!(is_limited_char_pool("8"));
        assert!(is_limited_char_pool("10"));
        assert!(is_limited_char_pool("12"));
        assert!(!is_limited_char_pool("6"));
        assert_eq!(hard_pity_for_pool("5"), 50);
        assert_eq!(hard_pity_for_pool("6"), 80);
        assert_eq!(hard_pity_for_pool("13"), 80);
    }

    #[test]
    fn test_request_serialization() {
        let params = GachaParams {
            player_id: "106485288".to_string(),
            record_id: "test".to_string(),
            resources_id: "test".to_string(),
            gacha_type: "1".to_string(),
            svr_id: "test".to_string(),
            lang: "zh-Hans".to_string(),
        };
        let request_body = ApiRequest {
            player_id: &params.player_id,
            record_id: &params.record_id,
            card_pool_id: &params.resources_id,
            server_id: &params.svr_id,
            language_code: &params.lang,
            card_pool_type: "1",
        };
        let json = serde_json::to_string(&request_body).unwrap();
        assert!(json.contains("\"cardPoolType\":\"1\""));
    }
}
