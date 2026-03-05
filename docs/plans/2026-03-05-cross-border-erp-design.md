# 跨境电商ERP系统设计

## 目标

替代赛狐，自建跨境电商ERP平台。核心解决发货流程效率问题，实现订单自动化处理。

先内部使用验证，后续对外SaaS化。

## 技术栈

- **框架**: Next.js App Router (全栈单体)
- **数据库**: PostgreSQL + Prisma ORM
- **前端**: React + Tailwind CSS
- **后台任务**: Workers (定时同步/自动化)
- **部署**: Docker / Vercel

## 项目结构

```
├── app/
│   ├── (dashboard)/          # 前端页面
│   │   ├── page.tsx          # Dashboard 总览
│   │   ├── orders/           # 订单管理
│   │   ├── shipping/         # 发货工作台
│   │   ├── products/         # 产品/SKU管理
│   │   ├── shops/            # 店铺管理
│   │   ├── warehouses/       # 仓库管理
│   │   ├── logistics/        # 物流渠道管理
│   │   ├── rules/            # 自动化规则
│   │   └── settings/         # 系统设置
│   ├── api/                  # API Routes
│   │   ├── orders/
│   │   ├── platforms/
│   │   ├── logistics/
│   │   └── automation/
│   └── layout.tsx
├── lib/
│   ├── platforms/            # 电商平台API对接
│   │   ├── base.ts           # 统一接口定义
│   │   ├── temu.ts
│   │   ├── amazon.ts
│   │   ├── tiktok.ts
│   │   └── shein.ts
│   ├── logistics/            # 物流对接
│   │   ├── base.ts           # 统一物流接口
│   │   ├── aggregators/      # 物流聚合平台
│   │   │   ├── fourpx.ts     # 递四方
│   │   │   └── easyship.ts   # Easyship
│   │   ├── compare.ts        # 比价引擎
│   │   └── tracker.ts        # 物流追踪(17TRACK/快递鸟)
│   └── automation/           # 自动化引擎
│       ├── engine.ts         # 规则匹配引擎
│       └── actions.ts        # 自动化动作
├── prisma/
│   └── schema.prisma
├── workers/                  # 后台任务
│   ├── order-sync.ts         # 订单同步
│   └── auto-ship.ts          # 自动发货
└── docker-compose.yml
```

## 数据模型

### Product (产品)

各平台SKU统一，不需要SKU映射。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| sku | String | 统一SKU |
| name | String | 产品名称 |
| weight | Float | 重量(g) |
| length/width/height | Float | 尺寸(cm) |
| createdAt | DateTime | 创建时间 |

### Shop (店铺)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | String | 店铺名称 |
| platform | Enum | Temu/Amazon/TikTok/SHEIN |
| credentials | JSON | API密钥/Token(加密存储) |
| defaultWarehouseId | UUID? | 默认仓库 |
| settings | JSON | 店铺级配置 |
| isActive | Boolean | 是否启用 |

### Order (订单)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| shopId | UUID | 关联店铺 |
| platformOrderId | String | 平台订单号 |
| status | Enum | pending/processing/shipped/delivered/cancelled |
| items | JSON | 订单商品明细 [{sku, qty, price}] |
| shippingAddress | JSON | 收件人信息 |
| warehouseId | UUID? | 分配的仓库 |
| totalAmount | Decimal | 订单金额 |
| currency | String | 币种 |
| platformCreatedAt | DateTime | 平台下单时间 |
| syncedAt | DateTime | 同步时间 |

### Warehouse (仓库)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | String | 仓库名称 |
| address | JSON | 仓库地址 |
| supportedPlatforms | Enum[] | 支持的平台 |
| isActive | Boolean | 是否启用 |

### WarehouseStock (库存)

| 字段 | 类型 | 说明 |
|------|------|------|
| warehouseId | UUID | 仓库 |
| productId | UUID | 产品 |
| quantity | Int | 库存数量 |

### LogisticsChannel (物流渠道)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| provider | String | 物流聚合平台(fourpx/easyship) |
| channelCode | String | 渠道代码 |
| name | String | 渠道名称 |
| routes | JSON | 支持的路线(起始国→目的国) |
| weightRange | JSON | 重量范围限制 |
| estimatedDays | String | 时效范围 |
| isActive | Boolean | 是否启用 |

### LogisticsRecord (物流记录)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| orderId | UUID | 关联订单 |
| channelId | UUID | 使用的渠道 |
| trackingNumber | String? | 物流追踪号 |
| labelUrl | String? | 面单URL |
| quotedPrice | Decimal | 报价 |
| actualPrice | Decimal? | 实际费用 |
| status | Enum | quoted/booked/shipped/delivered |

### AutomationRule (自动化规则)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | String | 规则名称 |
| priority | Int | 优先级(数字越小越高) |
| conditions | JSON | 匹配条件 |
| actions | JSON | 执行动作 |
| isActive | Boolean | 是否启用 |

条件示例:
```json
{
  "platform": ["Temu"],
  "country": ["US", "CA"],
  "weightRange": { "min": 0, "max": 2000 }
}
```

动作示例:
```json
{
  "assignWarehouse": "warehouse-uuid",
  "assignChannel": "channel-uuid",
  "channelStrategy": "cheapest"
}
```

## 核心流程

### 自动化发货流程

```
1. 订单同步 (定时轮询各平台API / Webhook)
   ↓
2. 新订单进入待处理队列
   ↓
3. 匹配自动化规则
   ├── 按平台/国家/重量/SKU匹配
   ├── 自动分配仓库
   └── 自动选择物流策略(最便宜/最快/指定渠道)
   ↓
4. 物流比价 (调用聚合平台API获取多渠道报价)
   ↓
5. 生成发货单 → 批量提交到物流聚合平台
   ↓
6. 获取物流单号和面单
   ↓
7. 回传追踪号到各电商平台
   ↓
8. 完成 ✓
```

### 平台对接统一接口

```typescript
interface PlatformAdapter {
  syncOrders(since: Date): Promise<Order[]>;
  getOrderDetail(platformOrderId: string): Promise<Order>;
  shipOrder(platformOrderId: string, trackingNumber: string, carrier: string): Promise<void>;
  getProducts(): Promise<Product[]>;
}
```

### 物流对接统一接口

```typescript
interface LogisticsProvider {
  getChannels(from: string, to: string): Promise<Channel[]>;
  getQuote(shipment: ShipmentInfo): Promise<Quote[]>;
  createShipment(order: Order, channel: Channel): Promise<Shipment>;
  getLabel(shipmentId: string): Promise<Buffer>;
  track(trackingNumber: string): Promise<TrackingInfo>;
}
```

## MVP页面

| 页面 | 功能 |
|------|------|
| Dashboard | 待发货数、今日发货、异常订单、快捷操作 |
| Orders | 订单列表、筛选搜索、批量操作、状态流转 |
| Shipping | 发货工作台、一键自动发货、批量比价、批量下单 |
| Products | SKU管理、库存查看 |
| Shops | 店铺授权、API配置、默认设置 |
| Warehouses | 仓库管理、库存管理 |
| Logistics | 物流渠道管理、聚合平台配置 |
| Rules | 自动化规则CRUD、优先级排序、测试 |
| Settings | 系统设置 |

## MVP优先级

Phase 1: 基础框架 + 订单管理
- 项目搭建、数据库、认证
- 产品/仓库/店铺 CRUD
- 手动导入订单(Excel)

Phase 2: 平台对接
- 对接第一个平台API(Temu)
- 订单自动同步
- 追踪号回传

Phase 3: 物流对接
- 对接递四方/Easyship API
- 比价引擎
- 自动下单获取面单

Phase 4: 自动化引擎
- 规则配置
- 自动匹配仓库和渠道
- 一键批量发货

Phase 5: 扩展
- 对接更多平台(Amazon/TikTok/SHEIN)
- 对接更多物流商
- 数据报表和分析
