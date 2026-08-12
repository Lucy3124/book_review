export const TAXONOMY = [
  {
    name: "法规与政策类差错",
    color: "#b42318",
    children: [
      "法律法规对图书内容导向的规定",
      "涉及法律法规或文件摘录、引用的差错",
      "涉及国土统一、主权和领土完整的差错",
      "涉及党政机构名称、党和国家领导人职务及姓名的差错",
      "涉及民族问题和宗教问题的差错",
      "涉及国家秘密的差错",
      "涉及未成年人教育的差错",
      "涉及台湾地区机构称谓的差错",
      "涉及国际关系的差错"
    ]
  },
  { name: "文字差错", color: "#c2410c", children: ["错别字", "不规范字", "多字、漏字、倒字"] },
  { name: "词语差错", color: "#a16207", children: ["误解词义", "生造词语和乱改成语", "字母词使用不当和滥用网络词语"] },
  { name: "科技名词差错", color: "#047857", children: ["基本性差错", "专业性差错"] },
  {
    name: "语法差错",
    color: "#0369a1",
    children: ["搭配不当", "成分残缺", "成分多余", "虚词差错", "语义不当", "语句歧义", "句式杂糅"]
  },
  { name: "标点符号差错", color: "#4338ca", children: ["点号差错", "标点差错", "中文出版物夹用英文的标点差错"] },
  { name: "知识性差错", color: "#7e22ce", children: ["事实性差错", "科学性差错"] }
];

export const TAXONOMY_MAP = new Map(TAXONOMY.flatMap((group) => group.children.map((child) => [child, group.name])));

export const FINDING_LEVELS = ["明确差错", "疑似差错", "高风险待专家判断"];
export const SEVERITIES = ["严重", "重要", "一般"];
export const REVIEW_STATUSES = ["待判断", "已确认", "已忽略"];
