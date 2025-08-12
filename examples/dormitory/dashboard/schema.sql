-- D1 数据库表结构
DROP TABLE IF EXISTS data;

CREATE TABLE data (
    id INTEGER PRIMARY KEY,
    count INTEGER DEFAULT 0
);

-- 初始化计数器（id=1）
INSERT INTO data (id, count) VALUES (1, 0);
