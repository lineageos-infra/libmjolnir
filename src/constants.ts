const VENDOR_SAMSUNG = 0x04e8
const PRODUCT_GALAXY_S = 0x6601
const PRODUCT_GALAXY_S2 = 0x685d
const PRODUCT_DROID_CHARGE = 0x68c3

export const UsbConstants = {
  DeviceFilters: [
    { vendorId: VENDOR_SAMSUNG, productId: PRODUCT_GALAXY_S },
    { vendorId: VENDOR_SAMSUNG, productId: PRODUCT_GALAXY_S2 },
    { vendorId: VENDOR_SAMSUNG, productId: PRODUCT_DROID_CHARGE }
  ]
}

export default {
  UsbConstants
}
