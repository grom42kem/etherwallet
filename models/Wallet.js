const mongoose = require("mongoose");
mongoose.set("useFindAndModify", false);
mongoose.set("useCreateIndex", true);

const walletSchema = new mongoose.Schema({
    chat_id: Number,
    address: String,
    encryptedPrivateKey: String,
});

const Wallet = mongoose.model("Wallet", walletSchema);

module.exports = Wallet;
