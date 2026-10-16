# 补丁：修复 `/image/current/search` 对 Manheim 车返回 400

- 日期：2026-10-16
- 影响接口：`GET /api/car/thirdweb/image/current/search?blurry=<rego|vin>`（后台"重新取图"按钮）

## 根因
`CarCrawlerTurnersServiceImpl.findCurrentImages` 第一步 `selectOne` 查 Turners 表；
对 **Manheim 车**（Turners 表没有）返回 `null`，下一行 `entity.getId()` 空指针 → 若依包成 400。

## 改动 1：`CarCrawlerTurnersServiceImpl.findCurrentImages`（加 null 守卫）

```java
        CarCrawlerTurners entity = this.baseMapper.selectOne(wrapper);

        // 非 Turners 车（如 Manheim 车）在 Turners 表查不到 → 返回空，避免 entity.getId() 空指针(400)
        if (entity == null) {
            return new ArrayList<String>();
        }

        //查询本地数据，是否已获取到图片
        QueryWrapper imageWrapper = new QueryWrapper();
        imageWrapper.eq("turners_id", entity.getId());
        ...
```
（`ArrayList` 该文件已 import。）

## 改动 2：`CarThirdWebController.queryCurrentImage`（空则回退 Manheim 库存图）

```java
    public ResponseEntity<List<String>> queryCurrentImage(CarThirdWebQueryDto dto) {

        List<String> images = carCrawlerTurnersService.findCurrentImages(dto);

        // Manheim 车在 Turners 没有 → 回退到 Manheim 库存图，使该接口对两类车都可用
        if (CollUtil.isEmpty(images)) {
            images = carCrawlerManheimService.findOneImages(dto);
        }

        return new ResponseEntity<>(images, HttpStatus.OK);
    }
```
（`CollUtil`、`carCrawlerManheimService` 该 controller 已有。）

## 效果
- Manheim 车点"重新取图"不再 400，直接返回其 Manheim 库存图（走 S3 下载+上传）。
- Turners 车行为不变。

## 部署
改在你们的 Java 仓库对应两个文件，重新构建部署 car-recycl-system。
（本补丁已同步应用到本仓库的参考副本 `car-recycl-admin/.../CarCrawlerTurnersServiceImpl.java`
与 `CarThirdWebController.java`，但参考副本不入本仓库 git，请以你们线上仓库为准。）

## 遗留
`S3Service.downloadFromUrlAndUploadFile` 的 catch 只捕获 `MalformedURLException`，
下载/S3 失败会继续上抛（可能 400/500）。若线上 `/home/ubuntu/java` 不可写或 S3 权限异常，
需另修（建议 try/catch 全包 + 失败跳过单张图而非整体失败）。本补丁未改这块。
